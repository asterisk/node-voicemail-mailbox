/**
 * Mailbox Reader module for Asterisk voicemail.
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
var messagesHelper = require('./helpers/messages.js');

/**
 * Returns a new finite state machine instance for the given channel and
 * helpers intended to be used to listen to messages.
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
      channel.hangup()
        .catch(function(err) {
          // ignore errors
        });
    },

    // handler for channel hanging up
    hangupHandler: function(event) {
      this.transition('done');
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // returns a sounds array for use in playing a menu using the current
    // messages helper as a context
    getMenu: function() {
      var sounds = this.messages.calculateMenu();

      return sounds.map(function(sound) {
        return dependencies
          .config
          .getAppConfig()
          .prompts
          .mailboxReader[sound];
      });
    },

    states : {
      // bootstrapping
      'init' : {
        _onEnter: function() {
          var self = this;

          dependencies.dal.folder.all()
            .then(function(folders) {
              self.folders = folders;
              self.currentFolder = folders[0];

              return dependencies.dal.message.all(mailbox, self.currentFolder);
            })
            .then(function(newMessages) {
              self.messages = messagesHelper.create(newMessages);

              return dependencies.config.getMailboxConfig(mailbox);
            })
            .then(function(mailboxConfig) {
              self.config = mailboxConfig;
              var ariConfig = dependencies.config.getAppConfig().ari;

              return ari.getClient(ariConfig, ariConfig.applicationName);
            })
            .then(function(client) {
              self.client = client;
              self.transition('ready');
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.on('StasisEnd', this.currentHangupHandler);
        },

        '*': function() {
          this.deferUntilTransition('ready');
        }
      },

      'intro': {
        _onEnter: function() {
          var self = this;

          var readerPrompts = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxReader;
          var sounds = this.messages.isNotEmpty() ?
                      readerPrompts.introMessages :
                      readerPrompts.introNoMessages;
          sounds.concat(this.getMenu());

          var replacements = {
            messageCount: this.messages.countNew,
            plural: this.messages.many() ? 's': ''
          };

          this.currentPrompt = dependencies.prompt.create(
              sounds, channel, replacements);

          this.currentPrompt.play()
            .then(function() {
              self.transition('ready');
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });
        },

        '*': function() {
          this.currentPrompt.stop();
          this.deferUntilTransition('ready');
        }
      },

      // ready to accept menu commands
      'ready': {
        playMessage: function(operation) {
          var self = this;

          var message = this.messages[operation]();

          if (operation === 'next' && !message) {
            dependencies.dal.message.latest(mailbox, this.currentFolder,
                                            this.messages.latest)
              .then(function(messages) {
                self.messages.add(messages);
                message = self.messages.next();
                self.handle('play', message);
              })
              .catch(function(err) {
                console.error(err.stack);
                self.hangup();
              });
          } else {
            if (message) {
            dependencies.dal.message.get()
              .then(function(instance) {
                if (!instance ||
                      instance.getFolder().getId() !== 
                        self.currentFolder.getId()) {

                  // message was deleted or moved
                  self.messages.remove(message);
                  self.handle('playMessage', operation);
                }
              })
              .catch(function(err) {
                console.error(err.stack);
                self.hangup();
              });
            } else {
              this.handle('play', message);
            }
          }
        },

        'delete': function() {
          var self = this;

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          var message = this.messages.current();

          if (message) {
            this.messages.remove(message);
            dependencies.dal.message.remove(message)
              .then(function() {
                return self.client.recordings.deleteStored({
                  recordingName: message.recording
                });
              })
              .catch(function(err) {
                // assume concurrent deletes
              });

            this.transition('processing');
            this.handle('menu');
          }
        },

        play: function(message) {
          var self = this;

          var sounds;
          var replacements;

          if (!message) {
            sounds = dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader
              .noMore;
          } else {
            sounds = dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader
              .messageInfo;
            sounds = sounds.concat(dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader
              .message);
            replacements = {
              recording: message.recording,
              order: this.messages.getOrder()
            };
          }

          this.currentPrompt = dependencies.prompt.create(
              sounds, channel, replacements);

          this.currentPrompt.play()
            .then(function(played) {
              if (played) {
                if (!message.read) {
                  // TODO: mwi
                }
                self.handle('menu');
              } else {
                self.transition('ready');
              }
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });

          this.transition('processing');
        }
      },

      // currently processing a menu command
      'processing': {
        menu: function() {
          var self = this;

          var replacements = {
            folder: this.currentFolder.recording
          };
          this.currentPrompt = dependencies.prompt.create(this.getMenu(),
                                                          channel,
                                                          replacements);

          this.currentPrompt.play()
            .then(function() {
              self.transition('ready');
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });
        },

        '*': function() {
          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.deferUntilTransition('ready');
        }
      },

      // done reading mailbox
      'done': {
        _onEnter: function() {
          // cleanup
          this.removeHangupHandler();
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
 * Returns a mailbox reader object that can be used to listen to messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} api - api for reading mailbox messages
 */
function create(mailbox, channel, dependencies) {
  var state = fsm(mailbox, channel, dependencies);

  var api = {
    first: function() {
      process.nextTick(function() {
        state.handle('playMessage', 'first');
      });
    },

    replay: function() {
      process.nextTick(function() {
        state.handle('playMessage', 'current');
      });
    },

    next: function() {
      process.nextTick(function() {
        state.handle('playMessage', 'next');
      });
    },

    prev: function() {
      process.nextTick(function() {
        state.handle('playMessage', 'prev');
      });
    },

    'delete': function() {
      process.nextTick(function() {
        state.handle('delete');
      });
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
