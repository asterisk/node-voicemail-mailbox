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
      dependencies.logger.trace('hangup called');

      channel.hangup()
        .catch(function(err) {
          // ignore errors
        });
    },

    // handler for channel hanging up
    hangupHandler: function(event) {
      dependencies.logger.trace('hangupHandler called');

      this.transition('done');
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        dependencies.logger.trace('Removing hangupHandler');

        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // returns a sounds array for use in playing a menu using the current
    // messages helper as a context
    getMenu: function() {
      dependencies.logger.trace('getMenu called');

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

      dependencies.logger.debug({
        menu: menu
      }, 'menu calculated');

      return menu;
    },

    playMenu: function(full) {
          var self = this;

          var readerPrompts = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxReader;

          var sounds = [];

          if (full) {
              sounds = sounds.concat(this.messages.isNotEmpty() ?
                                     readerPrompts.introMessages :
                                     readerPrompts.introNoMessages);
          }

          sounds = sounds.concat(this.getMenu());

          var replacements = {
            messageCount: this.messages.getCount(),
            plural: this.messages.manyExist() ? 's': '',
            folder: this.messages.getCurrentFolder().recording
          };

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.currentPrompt = dependencies.prompt.create(
              sounds, channel, replacements);

          this.currentPrompt.play()
            .then(function() {
              self.transition('ready');
            })
            .catch(function(err) {
              dependencies.logger.trace({
                err: err
              }, 'Error playing prompt');
            });
    },

    // Returns a sounds array for use in playing a change folder menu
    getChangeFolderMenu: function() {
      var sounds = dependencies
        .config
        .getAppConfig()
        .prompts
        .mailboxReader
        .changeFolder;

      return dependencies.prompt.create(sounds, channel);
    },

    states : {
      // bootstrapping
      'init' : {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In init');

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
              dependencies.logger.error({
                err: err
              }, 'Error loading folders/messages');

              self.hangup();
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.on('StasisEnd', this.currentHangupHandler);
        },

        '*': function() {
          dependencies.logger.trace('Deferring action until intro');

          this.deferUntilTransition('intro');
        }
      },

      'intro': {
        _onEnter: function() {
          dependencies.logger.trace('In intro');

          this.playMenu(true);
        },

        '*': function() {
          dependencies.logger.trace(
              'Stopping prompt and deferring action until ready');

          this.currentPrompt.stop();
          this.deferUntilTransition('ready');
        }
      },

      // ready to accept menu commands
      'ready': {
        _onEnter: function() {
          dependencies.logger.trace('In ready');
        },

        play: function(operation) {
          var self = this;

          dependencies.logger.trace('play called');

          this.messages[operation]()
            .then(function(message) {
              self.handle('playMessage', message);
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'Error running %s against messages', operation);

              self.hangup();
            });

            this.transition('fetching');
        },

        'delete': function() {
          var self = this;

          dependencies.logger.trace('delete called');

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.messages.delete()
            .catch(function(err) {
              // assume concurrent deletes
              dependencies.logger.error({
                err: err
              }, 'Error deleting message');
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
              dependencies.logger.error({
                err: err
              }, 'Error playing prompt');
            });

          this.transition('processing');
        },

        previousMenu: function() {
          var self = this;

          dependencies.logger.trace('previousMenu called');

          var sounds = dependencies
            .config
            .getAppConfig()
            .prompts
            .mailboxReader
            .goodbye;

          this.currentPrompt = dependencies.prompt.create(sounds, channel);

          this.currentPrompt.play()
            .finally(function(played) {
              self.hangup();
            });
        },

        repeatMenu: function() {
          dependencies.logger.trace('repeatMenu called');

          this.playMenu(false);
        },

        changeFolder: function() {
          dependencies.logger.trace('changeFolder called');

          this.currentPrompt = this.getChangeFolderMenu();

          this.currentPrompt.play()
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'Error playing prompt');
            });

          this.transition('changingFolder');
        }
      },

      // fetching a message
      'fetching': {
        _onEnter: function() {
          dependencies.logger.trace('In fetching');
        },

        playMessage: function(message) {
          var self = this;

          dependencies.logger.trace('playMessage called');

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
              dependencies.logger.error({
                err: err
              }, 'Error playing prompt');
            });

          this.transition('processing');
        },

        '*': function() {
          dependencies.logger.trace('Deferring action until processing');

          this.deferUntilTransition('processing');
        }
      },

      // currently processing a menu command
      'processing': {
        _onEnter: function() {
          dependencies.logger.trace('In processing');
        },

        menu: function() {
          var self = this;

          dependencies.logger.trace('menu called');

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
              dependencies.logger.error({
                err: err
              }, 'Error playing prompt');
            });
        },

        '*': function() {
          dependencies.logger.trace(
              'Stopping prompt and deferring action until ready');

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.deferUntilTransition('ready');
        }
      },

      // changing folder
      'changingFolder': {
        _onEnter: function() {
          dependencies.logger.trace('In changingFolder');
        },

        submit: function(option) {
          var self = this;

          dependencies.logger.trace('submit called');

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          if (option === '0' || option === '1') {
            this.messages.changeFolder(option)
              .then(function() {
                self.emit('FolderChanged');
                self.transition('intro');
              })
              .catch(function(err) {
                self.emit('Error', err);
              });

            this.transition('loadingFolder');
          } else {
            var sounds = dependencies
              .config
              .getAppConfig()
              .prompts
              .mailboxReader
              .invalidFolder;

            this.currentPrompt = dependencies.prompt.create(sounds, channel);

            this.currentPrompt.play()
              .catch(function (err) {
                dependencies.logger.error({
                  err: err
                }, 'Error playing prompt');
              });
          }
        },

        previousMenu: function() {
          dependencies.logger.trace('changing folders - previousMenu called');

          this.transition('intro');
        },

        repeatMenu: function() {
          dependencies.logger.trace('changing folders - repeatMenu called');

          if (this.currentPrompt) {
            this.currentPrompt.stop();
          }

          this.currentPrompt = this.getChangeFolderMenu();

          this.currentPrompt.play()
            .catch(function(err) {
              dependencies.logger.error({err: err},
                'Error playing menu');
            });
        }
      },

      // loading folder messages
      'loadingFolder': {
        _onEnter: function() {
          dependencies.logger.trace('In loadingFolder');
        },

        '*': function() {
          dependencies.logger.trace('Deferring action until intro');

          this.deferUntilTransition('intro');
        }
      },

      // done reading mailbox
      'done': {
        _onEnter: function() {
          dependencies.logger.trace('In done');

          // cleanup
          this.removeHangupHandler();
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
 * Returns a mailbox reader object that can be used to listen to messages.
 *
 * @param {Mailbox} mailbox - a mailbox instance
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} api - api for reading mailbox messages
 */
function create(mailbox, channel, dependencies) {
  dependencies.logger = dependencies.logger.child({
    component: 'voicemail-mailbox-reader'
  });

  var state = fsm(mailbox, channel, dependencies);

  var api = {
    first: function() {
      dependencies.logger.trace('first called');

      process.nextTick(function() {
        state.handle('play', 'first');
      });
    },

    replay: function() {
      dependencies.logger.trace('replay called');

      process.nextTick(function() {
        state.handle('play', 'current');
      });
    },

    next: function() {
      dependencies.logger.trace('next called');

      process.nextTick(function() {
        state.handle('play', 'next');
      });
    },

    prev: function() {
      dependencies.logger.trace('prev called');

      process.nextTick(function() {
        state.handle('play', 'prev');
      });
    },

    'delete': function() {
      dependencies.logger.trace('delete called');

      process.nextTick(function() {
        state.handle('delete');
      });
    },

    previousMenu: function() {
      process.nextTick(function() {
        state.handle('previousMenu');
      });
    },

    repeatMenu: function() {
      process.nextTick(function() {
        state.handle('repeatMenu');
      });
    },

    changeFolder: function() {
      dependencies.logger.trace('changeFolder called');

      process.nextTick(function() {
        state.handle('changeFolder');
      });
    },

    submitFolder: function(option) {
      dependencies.logger.trace('submitFolder called');

      var deferred = Q.defer();

      state.on('FolderChanged', onChanged);

      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('submit', option);
      });

      return deferred.promise;

      function onChanged() {
        dependencies.logger.trace('Received FolderChanged from fsm');

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

        state.off('FolderChanged', onChanged);
        state.off('Error', onError);
      }
    }
  };

  dependencies.logger.info('Voicemail mailbox reader created');

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
