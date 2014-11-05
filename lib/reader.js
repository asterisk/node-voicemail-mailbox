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
      var menu = [];

      sounds.forEach(function(sound) {
        var part = dependencies
          .config
          .getAppConfig()
          .prompts
          .mailboxReader[sound];
        menu = menu.concat(part);
      });

      return menu;
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
              self.transition('intro');
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.on('StasisEnd', this.currentHangupHandler);
        },

        '*': function() {
          this.deferUntilTransition('intro');
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
          sounds = sounds.concat(this.getMenu());

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
              self.handle('playMessage', message);
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

          this.messages.delete()
            .catch(function(err) {
              // assume concurrent deletes
            });

          var sounds = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxReader
            .messageDeleted;
          this.currentPrompt = dependencies.prompt.create(sounds, channel);

          this.currentPrompt.play()
            .then(function(played) {
              if (played) {
                self.handle('menu');
              } {
                self.transition('ready');
              }
            })
            .catch(function(err) {
              console.error(err.stack);
            });

          this.transition('processing');
        },

        changeFolder: function() {
          var sounds = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxReader
            .changeFolder;

          this.currentPrompt = dependencies.prompt.create(sounds, channel);

          this.currentPrompt.play()
            .catch(function(err) {
              console.error(err.stack);
            });

          this.transition('changingFolder');
        }
      },

      // fetching a message
      'fetching': {
        playMessage: function(message) {
          var self = this;

          var sounds;
          var replacements;
          var availableSounds = dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader;

          if (!message) {
              sounds = availableSounds.noMore;
          } else {
            var order = this.messages.getOrder();

            if (order === 1) {
              order = 'sound:vm-first';
              sounds = availableSounds.messageInfoPre;
            } else if (order === this.messages.getCount()) {
              order = 'sound:vm-last';
              sounds = availableSounds.messageInfoPre;
            } else {
              order = util.format('number:%s', order);
              sounds = availableSounds.messageInfoPost;
            }

            sounds = sounds.concat(availableSounds.message);
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
            });
        },

        '*': function() {
          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.deferUntilTransition('ready');
        }
      },

      // changing folder
      'changingFolder': {
        submit: function(option) {
          var self =  this;

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          // for now, restrict to INBOX and Old folders
          if (option !== '0' && option !== '1') {
            var sounds = dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader
              .invalidFolder;

            this.currentPrompt = dependencies.prompt.create(sounds, channel);

            this.currentPrompt.play()
              .catch(function (err) {
                console.error(err.stack);
              });
          } else {
            this.messages.changeFolder(option)
              .then(function() {
                self.emit('FolderChanged');
                self.transition('intro');
              })
              .catch(function(err) {
                self.emit('Error', err);
              });

            this.transition('loadingFolder');
          }
        }
      },

      // loading folder messages
      'loadingFolder': {
        '*': function() {
          this.deferUntilTransition('intro');
        }
      },

      // done reading mailbox
      'done': {
        _onEnter: function() {
          // cleanup
          this.removeHangupHandler();
        },

        '*': function() {
          console.error('called handle on spent mailbox reader fsm instance.');
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
    },

    changeFolder: function() {
      process.nextTick(function() {
        state.handle('changeFolder');
      });
    },

    submitFolder: function(option) {
      var deferred = Q.defer();

      state.on('FolderChanged', onChanged);

      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('submit', option);
      });

      return deferred.promise;

      function onChanged() {
        removeListeners();
        deferred.resolve();
      }

      function onError(err) {
        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        state.off('FolderChanged', onChanged);
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
