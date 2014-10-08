/**
 * Mailbox Writer module for Asterisk voicemail.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var Q = require('q');
var ari = require('ari-client-wrapper');
var machina = require('machina');
var util = require('util');

/**
 * Returns a new finite state machine instance for the given channel and
 * helpers intended to be used to leave messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {machina.Fsm} fsm - a finite state machine instance
 */
function fsm(mailbox, channel, dependencies) {
  var fsmInstance = new machina.Fsm({

    initialState: 'init',

    // handler for channel hanging up
    hangupHandler: function(event) {
      if (!this.recording) {
        this.transition('done');
      }
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // handler for recording being finished
    recordingHandler: function(event, recording) {
      // store recording to get duration for save operation
      this.recording = recording;
      this.transition('recordingFinished');
      this.emit('RecordingFinished');
    },

    // removes handler for recording being finished
    removeRecordingHandler: function() {
      if (this.currentRecordingHandler) {
        this.recording.removeListener('RecordingFinished',
                                      this.currentRecordingHandler);
      }
    },

    states: {
      // bootstrapping
      'init': {
        _onEnter: function() {
          var self = this;

          var ariConfig = dependencies.config.getAppConfig().ari;
          ari.getClient(ariConfig, ariConfig.applicationName)
            .then(function(client) {
              self.client = client;

              return dependencies.config.getMailboxConfig(mailbox);
            })
            .then(function(mailboxConfig) {
              self.config = mailboxConfig;
              self.transition('ready');
            })
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.on('StasisEnd', this.currentHangupHandler);
        },

        '*': function() {
          this.deferUntilTransition('ready');
        }
      },

      // ready to record a message
      'ready' : {
        record: function() {
          var self = this;

          var intro = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxWriter
            .intro;
          this.introPrompt =  dependencies.prompt.create(intro, channel);
          this.introPrompt.play()
            .then(function(played) {
              self.transition('recording');
            })
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });
        },

        stop: function() {
          if (this.introPrompt) {
            this.transition('stoppingPrompt');
          }
        }
      },

      // stopping intro prompt
      'stoppingPrompt': {
        _onEnter: function() {
          this.introPrompt.stop();
        }
      },

      // recording a message
      'recording': {
        _onEnter: function() {
          var self = this;

          this.recording = this.client.LiveRecording();
          this.recording.name = util.format(
            'voicemail/%s/%s',
            mailbox.getId(),
            this.recording.name
          );

          var record = Q.denodeify(channel.record.bind(this.client));

          record({format: this.config['msg_format']}, this.recording)
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });

          this.currentRecordingHandler = this.recordingHandler.bind(this);
          this.recording.on('RecordingFinished', this.currentRecordingHandler);
        },

        stop: function() {
          var self = this;

          if (this.recording) {
            this.transition('stoppingRecording');
          }
        }
      },

      'stoppingRecording': {
        _onEnter: function() {
          var self = this;
          var stop = Q.denodeify(this.recording.stop.bind(this.recording));

          stop()
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });
        }
      },

      // recording finished
      'recordingFinished': {
        save: function() {
          this.transition('savingRecording');
        }
      },

      // saving recording
      'savingRecording': {
        _onEnter: function() {
          var self = this;

          dependencies.dal.folder.all()
            .then(function(folders) {
              var inbox = folders['0'];
              var message = dependencies.dal.message.create(
                mailbox,
                inbox,
                {
                  recording: self.recording.name,
                  duration: self.recording.duration,
                  callerId: channel.caller.name || channel.caller.number
                }
              );
              message.init();

              return dependencies.dal.message.save(message);
            })
            .then(function() {
              self.emit('RecordingSaved');
              self.transition('done');
            })
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });
        }
      },

      // done writing to mailbox 
      'done': {
        _onEnter: function() {
          // cleanup
          this.removeHangupHandler();
          this.removeRecordingHandler();
        },

        '*': function() {
          console.error('called handle on spent fsm instance.');
        }
      }
    }
  });

  return fsmInstance;
}

/**
 * Returns a mailbox writer object that can be used to leave messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} api - api for writing messages to a mailbox
 */
function create(mailbox, channel, dependencies) {
  var state = fsm(mailbox, channel, dependencies);

  var api = {
    record: function() {
      var deferred = Q.defer();

      state.on('RecordingFinished', onFinished);
      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('record');
      });

      return deferred.promise;

      function onFinished() {
        removeListeners();
        deferred.resolve();
      }

      function onError(err) {
        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        state.off('RecordingFinished', onFinished);
        state.off('Error', onError);
      }
    },

    stop: function() {
      process.nextTick(function() {
        state.handle('stop');
      });
    },

    review: function() {
      throw new Error('This has not been implemented yet');
    },

    save: function() {
      var deferred = Q.defer();

      state.on('RecordingSaved', onSaved);
      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('save');
      });

      return deferred.promise;

      function onSaved() {
        removeListeners();
        deferred.resolve();
      }

      function onError(err) {
        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        state.off('RecordingSaved', onSaved);
        state.off('Error', onError);
      }
    }
  };
  
  return api;
}

/**
 * Returns module functions.
 *
 * @returns {object} module - module functions
 */
module.exports = {
  create: create
};
