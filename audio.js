/* IRON FRONT — audio.js
   Everything you hear is generated at runtime, so the game still ships with
   no downloads. Three things make it sound like a battlefield rather than a
   beeping toy:
     - sounds are placed in stereo relative to where the camera is looking
     - distant sounds lose their high frequencies, the way real ones do
     - explosions are layered: a sub thump, a crack, and a debris tail

   To use recorded audio later, replace play() and speak(). Nothing else in
   the game touches the sound system. */
(function (IF) {
  'use strict';

  var A = {
    ctx: null,
    master: null, sfxBus: null, musicBus: null, ambBus: null,
    muted: false,
    volume: 0.6,
    musicOn: true,
    voiceOn: true,
    noiseBuf: null,
    last: {},
    started: false,

    /* ---------------------------------------------------------- setup */
    init: function () {
      if (this.ctx) return;
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      var c = this.ctx = new C();

      this.master = c.createGain();
      this.master.gain.value = this.volume;

      // A compressor keeps a dozen simultaneous explosions from clipping.
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;

      this.master.connect(comp);
      comp.connect(c.destination);

      this.sfxBus = c.createGain(); this.sfxBus.gain.value = 1.0; this.sfxBus.connect(this.master);
      this.musicBus = c.createGain(); this.musicBus.gain.value = 0.32; this.musicBus.connect(this.master);
      this.ambBus = c.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);

      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    },

    resume: function () {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.started) {
        this.started = true;
        this.startAmbience();
        if (this.musicOn) this.startMusic();
      }
    },

    setMuted: function (m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : this.volume;
    },

    setMusic: function (on) {
      this.musicOn = on;
      if (this.musicBus) this.musicBus.gain.value = on ? 0.32 : 0;
      if (on && this.ctx && !this.musicTimer) this.startMusic();
    },

    /* ---------------------------------------------- positional routing
       Returns the node a sound should connect to. Handles stereo placement,
       volume falloff and the muffling of anything far from the camera. */
    place: function (x, y, spread) {
      var c = this.ctx;
      var out = c.createGain();
      var vol = 1, pan = 0, cutoff = 18000;

      if (x !== undefined && IF.game) {
        var g = IF.game;
        var cx = g.cam.x + g.viewW / 2, cy = g.cam.y + g.viewH / 2;
        var dx = x - cx, dy = y - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var reach = Math.max(g.viewW, g.viewH) * (spread || 1.5);
        if (d > reach) return null;
        vol = Math.pow(1 - d / reach, 1.5);
        pan = IF.clamp(dx / (g.viewW * 0.55), -1, 1);
        cutoff = 18000 - IF.clamp(d / reach, 0, 1) * 15500;
      }
      out.gain.value = vol;

      var node = out;
      if (cutoff < 17000) {
        var lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(320, cutoff);
        out.connect(lp);
        node = lp;
      }

      if (c.createStereoPanner) {
        var p = c.createStereoPanner();
        p.pan.value = pan;
        node.connect(p);
        p.connect(this.sfxBus);
      } else {
        node.connect(this.sfxBus);
      }
      return out;
    },

    /* --------------------------------------------------- sound layers */
    noise: function (dest, dur, freq, q, vol, type, sweepTo) {
      var c = this.ctx, src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      var f = c.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.setValueAtTime(freq, c.currentTime);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), c.currentTime + dur);
      f.Q.value = q;
      var g = c.createGain();
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start();
      src.stop(c.currentTime + dur + 0.03);
    },

    tone: function (dest, f0, f1, dur, vol, type, delay) {
      var c = this.ctx, t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      o.connect(g); g.connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.03);
    },

    /* -------------------------------------------------------- playback */
    play: function (name, x, y) {
      if (!this.ctx || this.muted) return;

      // Twenty rifles firing on the same frame should sound like a volley,
      // not like twenty copies of one sample stacked on top of each other.
      var now = this.ctx.currentTime;
      var gap = { gun: 0.05, cannon: 0.055, flak: 0.05, hit: 0.05, boom: 0.045,
                  rocket: 0.07, plane: 0.35, crush: 0.15 }[name] || 0;
      if (gap && this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;

      var uiSound = !x;
      var d = uiSound ? this.sfxBus : this.place(x, y, name === 'boom' ? 2.2 : 1.5);
      if (!d) return;

      switch (name) {
        case 'gun':
          this.noise(d, 0.05, 2400, 1.1, 0.16);
          this.noise(d, 0.11, 420, 0.7, 0.09, 'lowpass');
          break;
        case 'cannon':
          this.tone(d, 150, 42, 0.28, 0.30, 'sine');
          this.noise(d, 0.09, 1500, 0.8, 0.26);
          this.noise(d, 0.42, 700, 0.5, 0.10, 'lowpass', 180);
          break;
        case 'rocket':
          this.noise(d, 0.55, 1500, 0.7, 0.20, 'bandpass', 380);
          this.tone(d, 700, 150, 0.5, 0.10, 'sawtooth');
          break;
        case 'flak':
          this.noise(d, 0.09, 3000, 2.4, 0.17);
          this.tone(d, 1400, 700, 0.14, 0.07, 'square');
          break;
        case 'hit':
          this.noise(d, 0.07, 1800, 2.0, 0.15);
          this.tone(d, 900, 400, 0.09, 0.08, 'triangle');
          break;
        case 'boom':
          this.tone(d, 110, 24, 0.75, 0.42, 'sine');            // the thump you feel
          this.noise(d, 0.16, 900, 0.6, 0.34);                  // the crack
          this.noise(d, 1.1, 500, 0.4, 0.16, 'lowpass', 110);   // debris and rumble
          this.tone(d, 60, 30, 1.0, 0.14, 'triangle', 0.05);
          break;
        case 'bombdrop':
          this.tone(d, 1400, 260, 0.85, 0.13, 'sine');
          break;
        case 'plane':
          this.noise(d, 1.1, 240, 1.6, 0.11, 'bandpass', 190);
          break;
        case 'crush':
          this.noise(d, 0.3, 320, 0.9, 0.26, 'lowpass');
          this.noise(d, 0.1, 1700, 1.6, 0.12);
          break;

        /* interface */
        case 'select':   this.tone(d, 620, 880, 0.06, 0.13, 'square'); break;
        case 'order':    this.tone(d, 380, 640, 0.08, 0.11, 'triangle'); break;
        case 'build':    this.noise(d, 0.3, 600, 0.6, 0.13, 'lowpass'); this.tone(d, 190, 260, 0.24, 0.09, 'square'); break;
        case 'complete': this.tone(d, 480, 480, 0.13, 0.13, 'triangle'); this.tone(d, 720, 720, 0.20, 0.11, 'triangle', 0.12); break;
        case 'promote':  this.tone(d, 620, 620, 0.10, 0.12, 'triangle'); this.tone(d, 930, 930, 0.14, 0.11, 'triangle', 0.09); this.tone(d, 1240, 1240, 0.20, 0.09, 'triangle', 0.18); break;
        case 'deny':     this.tone(d, 240, 120, 0.18, 0.14, 'square'); break;
        case 'alert':    this.tone(d, 900, 640, 0.20, 0.15, 'square'); this.tone(d, 900, 640, 0.20, 0.13, 'square', 0.26); break;
        case 'victory':
          [523, 659, 784, 1046].forEach(function (f, i) { A.tone(d, f, f, 0.34, 0.15, 'triangle', i * 0.16); });
          break;
        case 'defeat':
          [392, 330, 262, 196].forEach(function (f, i) { A.tone(d, f, f * 0.97, 0.5, 0.15, 'sawtooth', i * 0.24); });
          break;
      }
    },

    /* --------------------------------------------------------- ambience
       A quiet wind bed under everything so silence never feels like the
       sound has broken. */
    startAmbience: function () {
      var c = this.ctx;
      if (!c || this.ambSrc) return;
      var src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.55;
      var f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.5;
      var g = c.createGain(); g.gain.value = 0.05;

      // slow swell so the wind breathes
      var lfo = c.createOscillator(); lfo.frequency.value = 0.06;
      var lfoGain = c.createGain(); lfoGain.gain.value = 0.022;
      lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();

      src.connect(f); f.connect(g); g.connect(this.ambBus);
      src.start();
      this.ambSrc = src;

      this.startDistantGuns();
    },

    /* Artillery somewhere else on the front. You never see it — it just
       rumbles away over the horizon so the map never feels empty. */
    startDistantGuns: function () {
      var self = this;
      if (this.rumbleTimer) return;
      var schedule = function () {
        var wait = 5000 + Math.random() * 16000;
        self.rumbleTimer = setTimeout(function () {
          self.distantGun();
          schedule();
        }, wait);
      };
      schedule();
    },

    distantGun: function () {
      if (!this.ctx || this.muted) return;
      var c = this.ctx;
      var out = c.createGain();
      out.gain.value = 0.30 + Math.random() * 0.25;
      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 190 + Math.random() * 120;
      out.connect(lp);
      if (c.createStereoPanner) {
        var pan = c.createStereoPanner();
        pan.pan.value = Math.random() * 1.6 - 0.8;
        lp.connect(pan); pan.connect(this.ambBus);
      } else lp.connect(this.ambBus);

      var salvo = 1 + ((Math.random() * 3) | 0);
      for (var i = 0; i < salvo; i++) {
        var d = i * (0.18 + Math.random() * 0.25);
        this.tone(out, 70, 22, 1.1, 0.30, 'sine', d);
        this.noise(out, 1.4, 240, 0.4, 0.13, 'lowpass', 70);
      }
    },

    /* ------------------------------------------------------------ music
       A slow martial bed: timpani-ish pulse, a low drone, and a minor-key
       horn line that cycles. Deliberately sparse so it sits under the guns. */
    MUSIC: [
      [0, 3, 7, 3], [0, 3, 7, 10], [-2, 2, 5, 2], [-5, 0, 3, 7]
    ],
    startMusic: function () {
      var self = this;
      if (!this.ctx || this.musicTimer) return;
      this.musicStep = 0;
      this.musicNext = this.ctx.currentTime + 0.2;
      this.musicTimer = setInterval(function () { self.scheduleMusic(); }, 120);
    },

    scheduleMusic: function () {
      if (!this.ctx || !this.musicOn) return;
      var c = this.ctx, beat = 0.62;
      while (this.musicNext < c.currentTime + 0.6) {
        var t = this.musicNext;
        var bar = Math.floor(this.musicStep / 4) % this.MUSIC.length;
        var step = this.musicStep % 4;
        var root = 55 * Math.pow(2, this.MUSIC[bar][step] / 12);

        // drum pulse
        this.mTone(root * 0.5, root * 0.25, 0.34, 0.5, 'sine', t);
        if (step === 2) this.mNoise(0.16, 1800, 0.9, 0.10, t);

        // drone
        if (step === 0) this.mTone(root, root, beat * 4 * 0.95, 0.11, 'sawtooth', t);
        // horn
        if (step === 0 || step === 3) this.mTone(root * 4, root * 4, beat * 0.9, 0.055, 'triangle', t);

        this.musicNext += beat;
        this.musicStep++;
      }
    },
    mTone: function (f0, f1, dur, vol, type, t) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(lp); lp.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.05);
    },
    mNoise: function (dur, freq, q, vol, t) {
      var c = this.ctx, s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      var g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      s.connect(f); f.connect(g); g.connect(this.musicBus);
      s.start(t); s.stop(t + dur + 0.03);
    },

    /* ------------------------------------------------------------ voice */
    lastEva: 0,
    lastAck: 0,

    speak: function (text, pitch, rate) {
      if (!this.voiceOn || this.muted) return;
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      try {
        var s = window.speechSynthesis;
        var u = new SpeechSynthesisUtterance(text);
        u.pitch = pitch; u.rate = rate; u.volume = 0.9;
        s.speak(u);
      } catch (e) { /* no speech engine here — stay quiet */ }
    },

    eva: function (text) {
      var now = Date.now();
      if (now - this.lastEva < 2600) return;
      this.lastEva = now;
      this.speak(text, 0.72, 1.05);
    },

    ACKS: {
      select:  ['Reporting.', 'Awaiting orders.', 'Ready and waiting.', 'Standing by.'],
      move:    ['Moving out.', 'On our way.', 'Affirmative.', 'Yes sir.'],
      attack:  ['Engaging.', 'Opening fire.', 'Target acquired.', 'They are ours.'],
      promote: ['Promoted!', 'We are veterans now.']
    },

    ack: function (unitType, kind) {
      var now = Date.now();
      if (now - this.lastAck < 1500) return;
      this.lastAck = now;
      var lines = this.ACKS[kind] || this.ACKS.select;
      var pitch = 0.95;
      if (unitType === 'sniper' || unitType === 'engineer') pitch = 1.06;
      if (unitType && IF.UNITS[unitType] && IF.UNITS[unitType].armor === 'vehicle') pitch = 0.84;
      this.speak(lines[(Math.random() * lines.length) | 0], pitch, 1.12);
    }
  };

  IF.audio = A;
})(window.IF);
