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
              var inbox = folders[0];
              self.messages = messagesHelper.create(mailbox, folders, inbox,
                                                    dependencies);

              return self.messages.load();
            })
            .then(function() {
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
            messageCount: this.messages.getCount(),
            plural: this.messages.manyExist() ? 's': '',
            folder: this.messages.getCurrentFolder().recording
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
        play: function(operation) {
          var self = this;

          this.messages[operation]()
            .then(function(message) {
              this.handle('play', message);
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });

            this.transition('fetching');
        },

        'delete': function() {
          var self = this;

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          var message = this.messages.current();

          if (message) {
            this.messages.remove(message)
              .catch(function(err) {
                // assume concurrent deletes
              });

            this.transition('processing');
            this.handle('menu');
          }
        }
      },

      // fetching a message
      'fetching': {
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
            var order = this.messages.getOrder();

            if (order === 1) {
              order = 'sound:vm-first';
            } else if (order === this.messages.getCount()) {
              order = 'sound:vm-last';
            } else {
              order = util.format('number:%s', order);
            }

            replacements = {
              recording: message.recording,
              order: order
            };
          }

          this.currentPrompt = dependencies.prompt.create(
              sounds, channel, replacements);

          this.currentPrompt.play()
            .then(function(played) {
              if (played) {
                self.messages.markAsRead(message);
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
        },

        '*': function() {
          this.deferUntilTransition('processing');
        }
      },

      // currently processing a menu command
      'processing': {
        menu: function() {
          var self = this;

          var replacements = {
            folder: this.messages.getCurrentFolder().recording
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
        state.handle('play', 'first');
      });
    },

    replay: function() {
      process.nextTick(function() {
        state.handle('play', 'current');
      });
    },

    next: function() {
      process.nextTick(function() {
        state.handle('play', 'next');
      });
    },

    prev: function() {
      process.nextTick(function() {
        state.handle('play', 'prev');
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
