/**
 * Messages helper for interacting with folder messages.
 *
 * @module messages
 *
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var moment = require('moment');
var Q = require('q');
var ari = require('ari-client-wrapper');

/**
 * Returns an object representing a collection of messages.
 *
 * @param {Mailbox} mailbox - mailbox instance
 * @param {Folders} folders - folders object keyed by dtmf key
 * @param {Folder} folder - current folder
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} messages - a messages helper object
 */
function collection(mailbox, folders, currentFolder, dependencies) {
  var messages = [];
  // current index into messages
  var currentIndex = 0;
  // we may not have started playing messages or message could have been removed
  var currentMessage = false;
  // mailbox configuration
  var config;

  var getMessage = function() {
    return messages[currentIndex];
  };

  /**
   * Resolves or rejects the given deferred with a message if it exists.
   *
   * Note: this function must be bound to an instance of collection.
   *
   * @param {Message} message - a message instance
   * @param {Q} deferred - a Q deferred instance
   * @param {string} operation - first|next|prev|current
   * @returns {Q} promise - a promise containing a message
   */
  var ensureMessageExists = function(message, deferred, operation) {
    var self = this;

    dependencies.dal.message.get(message)
      .then(function(instance) {
        return !!instance;
      })
      .then(function(exists) {
        if (exists) {
          deferred.resolve(message);
        } else {
          self.remove(message);
          currentMessage = false;
          self[operation]()
            .then(function(message) {
              deferred.resolve(message);
            })
            .catch(function(err) {
              deferred.reject(err);
            });
        }
      })
      .catch(function(err) {
        deferred.reject(err);
      });
  };

  /**
   * Returns the latest messages for the current mailbox and folder.
   *
   * @param {Moment} latest - moment date of the latest message currently held
   * @returns {Q} promise - a promise containing the latest messages
   */
  var getLatest = function(latest) {
    return dependencies.dal.message.latest(mailbox, currentFolder, latest);
  };

  var collectionObj = {
    // 1900
    latest: moment.utc('1990-01-01T00:00:00.000Z'),

    previousExists: function() {
      return currentIndex > 0;
    },

    currentExists: function() {
      return currentMessage;
    },

    isEmpty: function() {
      return !!messages.length;
    },

    isNotEmpty: function() {
      return !this.isEmpty();
    },

    manyExist: function() {
      return messages.length > 1;
    },

    getCount: function() {
      return messages.length;
    },
  
    getOrder: function() {
      return currentIndex + 1;
    },

    getCurrentFolder: function() {
      return currentFolder;
    },

    first: function() {
      var self = this;

      var deferred = Q.defer();
      currentMessage = true;
      currentIndex = 0;
      var message = getMessage();

      if (!message) {
        getLatest(this.latest)
          .then(function(newMessages) {
            self.add(newMessages);

            deferred.resolve(getMessage());
          })
          .catch(function(err) {
            deferred.reject(err);
          });
      } else {
        ensureMessageExists.call(this, message, deferred, 'first');
      }

      return deferred.promise;
    },

    next: function() {
      var self = this;

      var deferred = Q.defer();
      currentIndex = currentMessage ? currentIndex + 1: currentIndex;
      currentMessage = true;
      var message = getMessage();

      // see if new messages have come in
      if (!message) {
        getLatest(this.latest)
          .then(function(newMessages) {
            self.add(newMessages);

            if (currentIndex === messages.length) {
              currentIndex -= 1;
            }

            deferred.resolve(getMessage());
          })
          .catch(function(err) {
            deferred.reject(err);
          });
      // ensure message still exists
      } else {
        ensureMessageExists.call(this, message, deferred, 'next');
      }

      return deferred.promise;
    },

    current: function() {
      var deferred = Q.defer();
      currentMessage = true;
      var message = getMessage();

      if (!message) {
        deferred.resolve();
      } else {
        ensureMessageExists.call(this, message, deferred, 'current');
      }

      return deferred.promise;
    },

    previous: function() {
      var deferred = Q.defer();
      currentMessage = true;
      currentIndex -= 1;
      var message = getMessage();

      if (!message) {
        if (currentIndex < 0) {
          currentIndex = 0;
        }

        deferred.resolve();
      } else {
        ensureMessageExists.call(this, message, deferred, 'prev');
      }

      return deferred.promise;
    },

    add: function(newMessages) {
      var self = this;

      if (!newMessages) {
        return;
      }

      if (!Array.isArray(newMessages)) {
        newMessages = [newMessages];
      }

      newMessages.forEach(function (message) {
        // skip duplicates
        var existing = messages.filter(function(candidate) {
          return candidate.getId() === message.getId() && message.getId();
        });

        if (!existing.length) {
          messages.push(message);

          if (message.date.isAfter(self.latest)) {
            self.latest = message.date;
          }
        }
      });
    },

    markAsRead: function(message) {
      var changed = message.markAsRead();

      if (changed) {
        dependencies.dal.message.markAsRead(message)
          .then(function(updated) {
            if (updated) {
              var notifier = dependencies.notify.create(mailbox, message);

              // TODO: move to Old folder
              return notifier.messageRead();
            }
          })
          .catch(function(err) {
            console.error(err.stack);
          });
      }
    },

    remove: function(message) {
      var ariConfig = dependencies.config.getAppConfig().ari;
      var client;
      currentMessage = false;

      // remove from our in memory array
      messages = messages.filter(function(candidate) {
        return candidate.getId() !== message.getId();
      });

      return ari.getClient(ariConfig, ariConfig.applicationName)
        .then(function(ariClient) {
          client = ariClient;

          // remove from db
          return dependencies.dal.message.remove(message);
        })
        .then(function(message) {
          if (message) {
            var notifier = dependencies.notify.create(mailbox, message);

            // update MWI
            return notifier.messageDeleted()
              .then(function() {
                // remove via ARI
                return client.recordings.deleteStored({
                  recordingName: message.recording
                });
              });
          }
        });
    },

    calculateMenu: function() {
      var menu = [];

      if (currentIndex === 0 && !currentMessage) {
        menu.push('menuFirst');
      }

      if (this.previousExists()) {
        menu.push('menuPrev');
      }

      if (currentMessage) {
        menu.push('menuRepeat');
      }

      if (currentIndex !== messages.length - 1) {
        menu.push('menuNext');
      }

      if (currentMessage) {
        menu.push('menuDelete');
      }

      return menu;
    },

    load: function() {
      var self = this;

      return dependencies.dal.message.all(mailbox, currentFolder)
        .then(function(allMessages) {
          self.add(allMessages);

          if (!config) {
            return dependencies.config.getMailboxConfig(mailbox)
              .then(function(mailboxConfig) {
                config = mailboxConfig;
              });
          }
        });
    }
  };

  return collectionObj;
}

/**
 * Creates a messages helper.
 *
 * @param {Mailbox} mailbox - mailbox instance
 * @param {Folders} folders - folders object keyed by dtmf key
 * @param {Folder} currentFolder - current folder
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {Messages} messages - a messages collection object for interacting
 *   with a mailboxe's messages
 */
function populateFromMessages(mailbox, folders, currentFolder, dependencies) {
  var messages = collection(mailbox, folders, currentFolder, dependencies);

  return messages;
}

/**
 * Returns module functions.
 *
 * @returns {object} module - module functions
 */
module.exports = {
  create: populateFromMessages
};
