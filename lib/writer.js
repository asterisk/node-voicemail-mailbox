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

    // hangs up the channel
    hangup: function() {
      dependencies.logger.trace('hangup called');

      channel.hangup()
        .catch(function(err) {
          // ignore errors
        });
    },

    // handler for channel hanging up
    hangupHandler: function(event) {
      dependencies.logger.trace('hangupHandler called');

      if (!this.recording) {
        this.transition('done');
      }
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        dependencies.logger.trace('Removing hangupHandler');

        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // handler for recording being finished
    recordingHandler: function(event, recording) {
      dependencies.logger.trace('recordingHandler called');

      dependencies.logger.debug({
        recording: recording
      }, 'RecordingFinished received');

      // store recording to get duration for save operation
      this.recording = recording;
      this.transition('recordingFinished');
      this.emit('RecordingFinished');
    },

    // removes handler for recording being finished
    removeRecordingHandler: function() {
      if (this.currentRecordingHandler) {
        dependencies.logger.trace('Removing recordingHandler');

        this.recording.removeListener('RecordingFinished',
                                      this.currentRecordingHandler);
      }
    },

    states: {
      // bootstrapping
      'init': {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In init');

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
              dependencies.logger.error({
                err: err
              }, 'Error connection to ARI/fetching mailbox config');

              self.hangup();
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.on('StasisEnd', this.currentHangupHandler);
        },

        '*': function() {
          dependencies.logger.trace('Deferring action until ready');

          this.deferUntilTransition('ready');
        }
      },

      // ready to record a message
      'ready' : {
        _onEnter: function() {
          dependencies.logger.trace('In ready');
        },

        record: function() {
          var self = this;

          dependencies.logger.trace('record called');

          var greeting = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxWriter
            .greeting || [];
          var intro = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxWriter
            .intro || [];
          var sounds = greeting.concat(intro);
          var replacements = {
            extension: mailbox.mailboxNumber,
            status: mailbox.busy ? 'vm-isonphone': 'vm-isunavail'
          };

          this.introPrompt = dependencies.prompt.create(sounds,
                                                        channel,
                                                        replacements);
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
          dependencies.logger.trace('stop called');

          if (this.introPrompt) {
            this.transition('stoppingPrompt');
          }
        }
      },

      // stopping intro prompt
      'stoppingPrompt': {
        _onEnter: function() {
          dependencies.logger.trace('In stoppingPrompt');

          this.introPrompt.stop();
        }
      },

      // recording a message
      'recording': {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In recording');

          this.recording = this.client.LiveRecording();
          this.recording.name = util.format(
            'voicemail/%s/%s',
            mailbox.getId(),
            this.recording.name
          );

          var record = Q.denodeify(channel.record.bind(this.client));

          record({format: this.config['msg_format']}, this.recording)
            .then(function(recording) {
              dependencies.logger.debug({
                recording: recording
              }, 'Recording channel');
            })
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });

          this.currentRecordingHandler = this.recordingHandler.bind(this);
          this.recording.on('RecordingFinished', this.currentRecordingHandler);
        },

        stop: function() {
          var self = this;

          dependencies.logger.trace('stop called');

          if (this.recording) {
            this.transition('stoppingRecording');
          }
        }
      },

      'stoppingRecording': {
        _onEnter: function() {
          dependencies.logger.trace('In stoppingRecording');

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
        _onEnter: function() {
          dependencies.logger.trace('In recordingFinished');
        },

        save: function() {
          dependencies.logger.trace('save called');

          this.transition('savingRecording');
        }
      },

      // saving recording
      'savingRecording': {
        _onEnter: function() {
          var self = this;
          var message;

          dependencies.logger.trace('In savingRecording');

          dependencies.dal.folder.all()
            .then(function(folders) {
              var inbox = folders['0'];
              message = dependencies.dal.message.create(
                mailbox,
                inbox,
                {
                  recording: self.recording.name,
                  duration: self.recording.duration,
                  callerId: channel.caller.name || channel.caller.number
                }
              );
              message.init();

              dependencies.logger.debug({
                message: message
              }, 'Saving message');

              return dependencies.dal.message.save(message);
            })
            .then(function() {
              var notifier = dependencies.notify.create(mailbox, message);

              return notifier.newMessage();
            })
            .then(function(mwiCounts) {
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
          dependencies.logger.trace('In done');

          // cleanup
          this.removeHangupHandler();
          this.removeRecordingHandler();
        },

        '*': function() {
          dependencies.logger.error('Called handle on spent fsm');
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
  dependencies.logger = dependencies.logger.child({
    component: 'voicemail-mailbox-writer'
  });

  var state = fsm(mailbox, channel, dependencies);

  var api = {
    record: function() {
      dependencies.logger.trace('record called');

      var deferred = Q.defer();

      state.on('RecordingFinished', onFinished);
      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('record');
      });

      return deferred.promise;

      function onFinished() {
        dependencies.logger.trace('Received RecordingFinished from fsm');

        removeListeners();
        deferred.resolve();
      }

      function onError(err) {
        dependencies.logger.trace('Received Error from fsm');

        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        dependencies.logger.trace('Removing fsm event handlers');

        state.off('RecordingFinished', onFinished);
        state.off('Error', onError);
      }
    },

    stop: function() {
      dependencies.logger.trace('stop called');

      process.nextTick(function() {
        state.handle('stop');
      });
    },

    review: function() {
      dependencies.logger.trace('review called');

      throw new Error('This has not been implemented yet');
    },

    save: function() {
      dependencies.logger.trace('save called');

      var deferred = Q.defer();

      state.on('RecordingSaved', onSaved);
      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('save');
      });

      return deferred.promise;

      function onSaved() {
        dependencies.logger.trace('Received RecordingSaved from fsm');

        removeListeners();
        deferred.resolve();
      }

      function onError(err) {
        dependencies.logger.trace('Received Error from fsm');

        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        dependencies.logger.trace('Removing fsm event handlers');

        state.off('RecordingSaved', onSaved);
        state.off('Error', onError);
      }
    }
  };
  
  dependencies.logger.info('Voicemail mailbox writer created');

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
