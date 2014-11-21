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
  // determines whether first message was played or not
  var firstMessagePlayed = false;
  // mailbox configuration
  var config;

  var getMessage = function() {
    dependencies.logger.debug({
      currentIndex: currentIndex
    }, 'Fetching message');

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

    dependencies.logger.trace('ensureMessageExists called');

    dependencies.dal.message.get(message)
      .then(function(instance) {
        return !!instance;
      })
      .then(function(exists) {
        if (exists) {
          dependencies.logger.debug({
            message: message
          }, 'Message still exists');

          currentMessage = true;
          firstMessagePlayed = true;
          deferred.resolve(message);
        } else {
          dependencies.logger.debug({
            message: message
          }, 'Message no longer exists');

          self.remove(message);
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
    dependencies.logger.trace('getLatest called');

    return dependencies.dal.message.latest(mailbox, currentFolder, latest);
  };

  var collectionObj = {
    // 1900
    latest: moment.utc('1990-01-01T00:00:00.000Z'),

    previousExists: function() {
      dependencies.logger.trace('previousExists called');

      var exists = currentIndex > 0;
      dependencies.logger.debug({
        value: exists
      }, 'Previous Exists?');

      return exists;
    },

    currentExists: function() {
      dependencies.logger.trace('currentExists called');

      var exists = currentMessage;
      dependencies.logger.debug({
        value: exists
      }, 'Current Exists?');

      return exists;
    },

    isEmpty: function() {
      dependencies.logger.trace('isEmpty called');

      var empty = messages.length ? false: true;
      dependencies.logger.debug({
        value: empty
      }, 'Empty?');

      return empty;
    },

    isNotEmpty: function() {
      dependencies.logger.trace('isNotEmpty called');

      var notEmpty = !this.isEmpty();
      dependencies.logger.debug({
        value: notEmpty
      }, 'Not Empty?');

      return notEmpty;
    },

    manyExist: function() {
      dependencies.logger.trace('manyExist called');

      var many = messages.length > 1;
      dependencies.logger.debug({
        value: many
      }, 'Many Exists?');

      return many;
    },

    getCount: function() {
      dependencies.logger.trace('getCount called');

      var count = messages.length;
      dependencies.logger.debug({
        value: count
      }, 'Count');

      return count;
    },
  
    getOrder: function() {
      dependencies.logger.trace('getOrder called');

      var order = currentIndex + 1;
      dependencies.logger.debug({
        value: order
      }, 'Order');

      return order;
    },

    getCurrentFolder: function() {
      dependencies.logger.trace('getCurrentFolder called');

     var folder = currentFolder;
      dependencies.logger.debug({
        value: folder.name
      }, 'Current Folder');

     return folder;
    },

    first: function() {
      var self = this;

      dependencies.logger.trace('first called');

      var deferred = Q.defer();
      currentIndex = 0;
      var message = getMessage();

      if (!message) {
        getLatest(this.latest)
          .then(function(newMessages) {
            self.add(newMessages);
            message = getMessage();

            if (message) {
              currentMessage = true;
              firstMessagePlayed = true;
            }

            deferred.resolve(message);
          })
          .catch(function(err) {
            deferred.reject(err);
          });
      } else {
        ensureMessageExists.call(this, message, deferred, 'first');
      }

      return deferred.promise
        .then(function(message) {
          dependencies.logger.debug({
            messageId: message.getId()
          }, 'First Message');

          return message;
        });
    },

    next: function() {
      var self = this;

      dependencies.logger.trace('next called');

      var deferred = Q.defer();
      currentIndex = currentMessage ? currentIndex + 1: currentIndex;
      var message = getMessage();

      // see if new messages have come in
      if (!message) {
        getLatest(this.latest)
          .then(function(newMessages) {
            self.add(newMessages);
            message = getMessage();

            if (currentIndex === messages.length) {
              currentIndex -= 1;
            }

            if (message) {
              currentMessage = true;
            }

            deferred.resolve(message);
          })
          .catch(function(err) {
            deferred.reject(err);
          });
      // ensure message still exists
      } else {
        ensureMessageExists.call(this, message, deferred, 'next');
      }

      return deferred.promise
        .then(function(message) {
          dependencies.logger.debug({
            messageId: message.getId()
          }, 'Next Message');

          return message;
        });
    },

    current: function() {
      dependencies.logger.trace('current called');

      var deferred = Q.defer();
      var message = getMessage();

      if (!message) {
        deferred.resolve();
      } else {
        ensureMessageExists.call(this, message, deferred, 'current');
      }

      return deferred.promise
        .then(function(message) {
          dependencies.logger.debug({
            messageId: message.getId()
          }, 'Current Message');

          return message;
        });
    },

    prev: function() {
      dependencies.logger.trace('prev called');

      var deferred = Q.defer();
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

      return deferred.promise
        .then(function(message) {
          dependencies.logger.debug({
            messageId: message.getId()
          }, 'Previous Message');

          return message;
        });
    },

    add: function(newMessages) {
      var self = this;

      dependencies.logger.trace('add called');

      if (!newMessages) {
        return;
      }

      if (!Array.isArray(newMessages)) {
        newMessages = [newMessages];
      }

      newMessages.forEach(function(message) {
        // skip duplicates
        var existing = messages.filter(function(candidate) {
          return candidate.getId() === message.getId() && message.getId();
        });

        if (!existing.length) {
          dependencies.logger.debug({
            message: message
          }, 'Adding message');

          messages.push(message);

          if (message.date.isAfter(self.latest)) {
            dependencies.logger.debug({
              latest: message.date.format()
            }, 'Latest updated');

            self.latest = message.date;
          }
        }
      });
    },

    markAsRead: function(message) {
      dependencies.logger.trace('markAsRead called');

      if (message) {
        var changed = message.markAsRead();

        if (changed) {
          // mark as read in db
          dependencies.dal.message.markAsRead(message)
            .then(function(updated) {
              if (updated) {
                var notifier = dependencies.notify.create(mailbox, message);

                // update MWI counts
                return notifier.messageRead()
                  .then(function() {
                    var old = folders[1];

                    // save to Old messages folder in db
                    return dependencies.dal.message.changeFolder(message, old)
                      .then(function() {
                        dependencies.logger.debug({
                          messageId: message.getId()
                        }, 'Message moved to Old folder');
                      });
                  });
              }
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'Error marking as read');
            });
        }
      }
    },

    /**
     * Removes the given message from the list of messages we keep track of.
     */
    remove: function(message) {
      dependencies.logger.trace('remove called');

      if (message) {
        // remove from our in memory array
        messages = messages.filter(function(candidate) {
          return candidate.getId() !== message.getId();
        });
      }
    },

    /**
     * Deletes the current message.
     */
    'delete': function() {
      dependencies.logger.trace('delete called');

      var ariConfig = dependencies.config.getAppConfig().ari;
      var client;
      var message = getMessage();
      currentMessage = false;

      this.remove(message);

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
                var deleteStored = Q.denodeify(
                  client.recordings.deleteStored.bind(client)
                );

                // remove via ARI
                return deleteStored({
                  recordingName: message.recording
                }).then(function() {
                  dependencies.logger.debug({
                    messageId: message.getId()
                  }, 'Message deleted');
                });
              });
          }
        });
    },

    calculateMenu: function() {
      dependencies.logger.trace('calculateMenu called');

      var menu = [];

      if (currentIndex === 0 && !currentMessage) {
        menu.push('menuFirst');
      }

      if (firstMessagePlayed) {
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
      }

      dependencies.logger.debug({
        menu: menu
      }, 'Menu calculated');

      return menu;
    },

    load: function() {
      var self = this;

      dependencies.logger.trace('load called');

      currentMessage = false;
      firstMessagePlayed = false;
      currentIndex = 0;
      messages = [];

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
    },

    changeFolder: function(option) {
      dependencies.logger.trace('changeFolder called');

      currentFolder = folders[option];

      return this.load();
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

  dependencies.logger.info({
    mailboxName: mailbox.mailboxName,
    folderName: currentFolder.name
  }, 'Messages helper created');

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
