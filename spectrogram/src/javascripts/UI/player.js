/********************************************************
Copyright 2016 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*********************************************************/

var Util = require('../util/util.js');

function Player() {
	// Create an audio graph.
	window.AudioContext = window.AudioContext || window.webkitAudioContext;
	context = new AudioContext();

	var analyser = context.createAnalyser();
	//analyser.fftSize = 2048 * 2 * 2
	// analyser.fftSize = (window.isMobile)? 2048 : 8192;
	// analyser.fftSize = (window.isMobile)?1024 : 2048;
	analyser.fftSize = 16384; // Increased FFT size for better high-frequency resolution
	analyser.minDecibels = -120; // Adjusted minDecibels for wider dynamic range
	analyser.smoothingTimeConstant = 0;

	// Create a mix.
	var mix = context.createGain();

	// Create a bandpass filter.
	var bandpass = context.createBiquadFilter();
	bandpass.Q.value = 10;
	bandpass.type = 'bandpass';

	var filterGain = context.createGain();
	filterGain.gain.value = 1;

	// Connect audio processing graph
	mix.connect(analyser);
	analyser.connect(filterGain);
	filterGain.connect(context.destination);

	this.context = context;
	this.mix = mix;
	// this.bandpass = bandpass;
	this.filterGain = filterGain;
	this.analyser = analyser;
	this.isPlaying = false;
	this.startTime = 0;
	this.pausedTime = 0;

	this.buffers = {};

	// Connect an empty source node to the mix.
	Util.loadTrackSrc(this.context, 'bin/snd/empty.mp3', function(buffer) {
		var source = this.createSource_(buffer, true);
		source.loop = true;
		source.start(0);
	}.bind(this));
	
}

Player.prototype.playSrc = function(src) {
	// Stop all of the mic stuff.
	this.filterGain.gain.value = 1;
	if (this.input) {
		this.input.disconnect();
		this.input = null;
		return;
	}

	if (this.buffers[src]) {
		$('#loadingSound').fadeIn(100).delay(1000).fadeOut(500);
		this.playHelper_(src);
		return;
	}

	$('#loadingSound').fadeIn(100);
	Util.loadTrackSrc(this.context, src, function(buffer) {
		this.buffers[src] = buffer;
		this.playHelper_(src);
		$('#loadingSound').delay(500).fadeOut(500);
	}.bind(this));
};

Player.prototype.playUserAudio = function(src) {
  // Stop all of the mic stuff.
  this.filterGain.gain.value = 1;
  if (this.input) {
    this.input.disconnect();
    this.input = null;
    return;
  }
  this.buffers['user'] = src.buffer;
  this.playHelper_('user');
};

Player.prototype.playHelper_ = function(src) {
	var buffer = this.buffers[src];
	this.currentSrc = src; // Keep track of the current source key
	this.source = this.createSource_(buffer, this.loop); // Always loop in this helper
	// Start playing from the beginning or from pausedTime if resuming
	var offset = this.pausedTime % buffer.duration;
	this.source.start(0, offset);
	this.startTime = this.context.currentTime - offset;
	this.isPlaying = true;

	if (!this.loop) {
		// Clear existing timer if any
		if (this.playTimer) {
			clearTimeout(this.playTimer);
		}
		this.playTimer = setTimeout(function() {
			this.stop();
		}.bind(this), (buffer.duration - offset) * 1000);
	}
};

Player.prototype.pause = function() {
	if (this.isPlaying && this.source) {
		this.source.stop(0); // Stop playback
		this.pausedTime = this.context.currentTime - this.startTime;
		this.isPlaying = false;
		if (this.playTimer) {
			clearTimeout(this.playTimer);
			this.playTimer = null;
		}
		// Note: this.source is now stopped and cannot be restarted.
		// A new source will be created in resume() or playHelper_()
	}
};

Player.prototype.resume = function() {
	// Check if we have a source to resume and it's not currently playing.
	// this.source might be null if stop() was called explicitly before pause.
	// this.buffers[this.currentSrc] ensures we have the audio data.
	if (!this.isPlaying && this.buffers[this.currentSrc]) {
		// playHelper will use this.pausedTime to start from the correct offset
		this.playHelper_(this.currentSrc);
	}
};

Player.prototype.seek = function(offset) {
	if (this.buffers[this.currentSrc]) { // Check if there's a current track to seek on
		var buffer = this.buffers[this.currentSrc];
		var wasPlaying = this.isPlaying;

		// If playing, calculate current progress before stopping
		if (this.isPlaying && this.source) {
			this.pausedTime = this.context.currentTime - this.startTime;
			this.source.stop(0); // Stop current playback
			this.isPlaying = false;
		}
		// If not playing (i.e., paused or stopped), this.pausedTime should already be set.

		// Calculate new pausedTime
		var newTime = this.pausedTime + offset;
		// Clamp newTime to the bounds of the buffer if not looping
		// If looping, allow seeking beyond buffer duration, it will be handled by modulo in playHelper_
		if (!this.loop) {
			if (newTime < 0) newTime = 0;
			if (newTime > buffer.duration) newTime = buffer.duration;
		} else {
            // Allow seeking to negative times when looping, it will wrap around.
            // For example, if at 0s and seek -5s on a 10s loop, it should go to 5s.
            if (newTime < 0) {
                newTime = buffer.duration + (newTime % buffer.duration);
            }
        }
		this.pausedTime = newTime;


		if (wasPlaying) {
			this.playHelper_(this.currentSrc); // Restart playback from the new position
		}
		// If it was paused, it remains paused but at the new seek position.
		// If it was stopped, it remains stopped at the new seek position.
		// The UI will need to be updated to reflect this.
	}
};


Player.prototype.live = function() {
	// The AudioContext may be in a suspended state prior to the page receiving a user
	// gesture. If it is, resume it.
	if (this.context.state === 'suspended') {
		this.context.resume();
	}
	if(window.isIOS){
		window.parent.postMessage('error2','*');
		console.log("cant use mic on ios");
	}else{
		if (this.input) {
			this.input.disconnect();
			this.input = null;
			return;
		}

		var self = this;
    navigator.mediaDevices.getUserMedia({audio: true}).then(function(stream) {
      self.onStream_(stream);
		}).catch(function() {
      self.onStreamError(this);
		});

		this.filterGain.gain.value = 0;
	}
};

Player.prototype.onStream_ = function(stream) {
	var input = this.context.createMediaStreamSource(stream);
	input.connect(this.mix);
	this.input = input;
	this.stream = stream;
};

Player.prototype.onStreamError_ = function(e) {
	// TODO: Error handling.
};

Player.prototype.setLoop = function(loop) {
	this.loop = loop;
};

Player.prototype.createSource_ = function(buffer, loop) {
	var source = this.context.createBufferSource();
	source.buffer = buffer;
	source.loop = loop;
	source.connect(this.mix);
	return source;
};

Player.prototype.setMicrophoneInput = function() {
	// TODO: Implement me!
};

Player.prototype.stop = function(isSeeking = false) { // Added isSeeking parameter
	if (this.source) {
		this.source.stop(0);
		this.source = null; // Explicitly nullify to prevent reuse of stopped source
		if (this.playTimer) {
			clearTimeout(this.playTimer);
			this.playTimer = null;
		}
	}
	// Reset pausedTime only if not seeking, because seek needs the previous pausedTime.
	// When a track ends naturally (not looping) or is explicitly stopped by user (not via pause),
	// it should reset to the beginning.
	if (!isSeeking) {
		this.pausedTime = 0;
	}
	this.isPlaying = false;

	if (this.input && !isSeeking) {
		this.input.disconnect();
		this.input = null;
	}
};

Player.prototype.getAnalyserNode = function() {
	return this.analyser;
};

Player.prototype.setBandpassFrequency = function(freq) {
	if (freq == null) {
		console.log('Removing bandpass filter');
		// Remove the effect of the bandpass filter completely, connecting the mix to the analyser directly.
		this.mix.disconnect();
		this.mix.connect(this.analyser);
	} else {
		// console.log('Setting bandpass frequency to %d Hz', freq);
		// Only set the frequency if it's specified, otherwise use the old one.
		this.bandpass.frequency.value = freq;
		this.mix.disconnect();
		this.mix.connect(this.bandpass);
		// bandpass is connected to filterGain.
		this.filterGain.connect(this.analyser);
	}
};

Player.prototype.playTone = function(freq) {
	if (!this.osc) {
		this.osc = this.context.createOscillator();
		this.osc.connect(this.mix);
		this.osc.type = 'sine';
		this.osc.start(0);
	}
	this.osc.frequency.value = freq;
	this.filterGain.gain.value = .2;

	
};

Player.prototype.stopTone = function() {
	this.osc.stop(0);
	this.osc = null;
};

module.exports = Player;
