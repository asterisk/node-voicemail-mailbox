/**
 *  Messages Helper specific unit tests.
 *
 *  @module messages-test 
 *  @copyright 2014, Digium, Inc.
 *  @license Apache License, Version 2.0
 *  @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global before:false*/
/*global after:false*/
/*global it:false*/

var assert = require('assert');
var Q = require('q');
var mockery = require('mockery');
var moment = require('moment');

var mockClient;
var messages;
// keeps track of messages operations performed
var operations = [];
// used to test whether recording was deleted through ARI
var recordingDeleted = false;
// used to test whether MWI was updated
var mwiUpdated = false;
// milliseconds to delay async ops for mock requests
var asyncDelay = 100;
var mockeryOpts = {
  warnOnReplace: false,
  warnOnUnregistered: false,
  useCleanCache: true
};

/**
 * Returns a mock client.
 */
var getMockClient = function() {

  if (mockClient) {
    return mockClient;
  }

  mockClient = {
    recordings: {
      deleteStored: function(opts, cb) {
        setTimeout(function() {
          recordingDeleted = true;
          cb(null);
        }, asyncDelay);
      }
    }
  };

  return mockClient;
};

/**
 * Returns a mock mailbox for testing.
 */
var getMockMailbox = function() {
  var mailbox = {
    mailboxNumber: '1234',
    mailboxName: 'mine',
    password: '1111',
    name: 'mr smith',
    email: 'smith@email.com',
    unread: 1,
    read: 1,

    getId: function() {
      return 1;
    },

    getContext: function() {
      return {
        domain: 'email.com',

        getId: function() {
          return 1;
        }
      };
    }
  };

  return mailbox;
};

/**
 * Returns mock folders for testing.
 */
var getMockFolders = function() {
  var folders = [{
    name: 'INBOX',
    recording: 'vm-INBOX',
    dtmf: '0',

    getId: function() {
      return 1;
    }
  }, {
    name: 'Old',
    recording: 'vm-Old',
    dtmf: '1',

    getId: function() {
      return 2;
    }
  }];

  return folders;
};

/**
 * Returns mock messages for testing.
 */
var getMockMessages = function() {
  var messages = [{
    date: moment.utc(),
    read: false,
    callerId: 'me',
    duration: 10,
    recording: 'voicemail/10/recording1',
    getMailbox: getMailbox,
    getFolder: getFolder,
    init: init,
    markAsRead: markAsRead,

    getId: function() {
      return 1;
    }
  },{
    date: moment.utc(),
    read: false,
    callerId: 'me',
    duration: 12,
    recording: 'voicemail/10/recording2',
    getMailbox: getMailbox,
    getFolder: getFolder,
    init: init,
    markAsRead: markAsRead,

    getId: function() {
      return 2;
    }
  },{
    date: moment.utc(),
    read: false,
    callerId: 'me',
    duration: 13,
    recording: 'voicemail/10/recording3',
    getMailbox: getMailbox,
    getFolder: getFolder,
    init: init,
    markAsRead: markAsRead,

    getId: function() {
      return 3;
    }
  },{
    date: moment.utc(),
    read: false,
    callerId: 'me',
    duration: 14,
    recording: 'voicemail/10/recording4',
    getMailbox: getMailbox,
    getFolder: getFolder,
    init: init,
    markAsRead: markAsRead,

    getId: function() {
      return 4;
    }
  }];

  return messages;

  function getMailbox() {
    return getMockMailbox();
  }

  function getFolder() {
    return getMockFolders()[0];
  }

  function init() {
    /*jshint validthis:true*/
    this.date = moment.utc();
    this.read = false;
  }

  function markAsRead() {
    /*jshint validthis:true*/
    if (!this.read) {
      this.read = true;
      return true;
    }

    return false;
  }
};

/**
 * Returns a mock dal for testing.
 */
var getMockDal = function() {
  return {
    message: {
      get: function(message) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('get');
          innerDeferred.resolve(message);
        }, asyncDelay);

        return innerDeferred.promise;
      },

      latest: function(mailbox, folder, latestMessage) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('latest');
          innerDeferred.resolve(getMockMessages());
        }, asyncDelay);

        return innerDeferred.promise;
      },

      markAsRead: function(message) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('markAsRead');
          innerDeferred.resolve(true);
        }, asyncDelay);

        return innerDeferred.promise;
      },

      changeFolder: function(message, folder) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('changeFolder');
          message.getFolder = function() {
            return folder;
          };

          innerDeferred.resolve(message);
        }, asyncDelay);

        return innerDeferred.promise;
      },

      remove: function(message) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('remove');
          innerDeferred.resolve(message);
        }, asyncDelay);

        return innerDeferred.promise;
      },

      all: function(mailbox, folder) {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          operations.push('all');
          innerDeferred.resolve(getMockMessages());
        }, asyncDelay);

        return innerDeferred.promise;
      }
    }
  };
};

/**
 * Returns a mock config for testing.
 */
var getMockConfig = function() {
  var ariConfig = {
    url: 'http://localhost:8088',
    username: 'asterisk',
    password: 'asterisk',
    applicationName: 'test'
  };

  return {
    getAppConfig: function() {
      return {
        ari: ariConfig
      };
    },

    getMailboxConfig: function() {
      var deferred = Q.defer();
      var mailboxConfig = {};

      setTimeout(function() {
        deferred.resolve(mailboxConfig);
      }, asyncDelay);

      return deferred.promise;
    }
  };
};

/**
 * Returns a mock notify helper for testing.
 */
var getMockNotify = function() {
  return {
    create: function(mailbox, message) {
      return {
        messageRead: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            mwiUpdated = true;
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        messageDeleted: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            mwiUpdated = true;
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        }
      };
    }
  };
};

describe('messages helper', function() {

  before(function(done) {
    mockery.enable(mockeryOpts);

    var clientMock = {
      getClient: function(config, appName) {
        var deferred = Q.defer();

        if (config.url && config.username &&
            config.password && appName) {
          deferred.resolve(getMockClient());
        }

        return deferred.promise;
      }
    };
    mockery.registerMock('ari-client-wrapper', clientMock);

    var mailbox = getMockMailbox();
    var folders = getMockFolders();
    var currentFolder = folders[0];
    var dependencies = {
      config: getMockConfig(),
      dal: getMockDal(),
      notify: getMockNotify()
    };

    messages = require('../lib/helpers/messages.js').create(
      mailbox,
      folders,
      currentFolder,
      dependencies
    );

    messages.load()
      .then(function() {
        done();
      })
      .done();
  });

  afterEach(function(done) {
    operations = [];
    recordingDeleted = false;
    mwiUpdated = false;

    done();
  });

  after(function(done) {
    mockery.disable();

    done();
  });

  it('should support checking messages latest date', function(done) {
    assert(messages.latest.isAfter(moment.utc('1990-01-01T00:00:00.000Z')));

    done();
  });

  it('should support checking messages for previous message failure',
      function(done) {
    assert(!messages.previousExists());

    done();
  });

  it('should support checking messages for current message failure',
      function(done) {
    assert(!messages.currentExists());

    done();
  });

  it('should support checking to see if messages is empty', function(done) {
    assert(!messages.isEmpty());
    assert(messages.isNotEmpty());

    done();
  });

  it('should support checking to see if messages has many', function(done) {
    assert(messages.manyExist());

    done();
  });

  it('should support checking messages count', function(done) {
    assert(messages.getCount() === 4);

    done();
  });

  it('should support checking messages order', function(done) {
    assert(messages.getOrder() === 1);

    done();
  });

  it('should support getting current folder', function(done) {
    assert(messages.getCurrentFolder().name === getMockFolders()[0].name);

    done();
  });

  it('should support getting first message', function(done) {
    messages.first()
      .then(function(message) {
        assert(message);
        assert(message.getId() === 1);

        done();
      })
      .done();
  });

  it('should support getting next message', function(done) {
    messages.next()
      .then(function(message) {
        assert(message);
        assert(message.getId() === 2);

        done();
      })
      .done();
  });

  it('should support checking messages for previous message success',
      function(done) {
    assert(messages.previousExists());

    done();
  });

  it('should support checking messages for current message success',
      function(done) {
    assert(messages.currentExists());

    done();
  });

  it('should support getting current message', function(done) {
    messages.current()
      .then(function(message) {
        assert(message);
        assert(message.getId() === 2);

        done();
      })
      .done();
  });

  it('should support getting previous message', function(done) {
    messages.prev()
      .then(function(message) {
        assert(message);
        assert(message.getId() === 1);

        done();
      })
      .done();
  });

  it('should support adding a message', function(done) {
    var currentLatest = messages.latest;

    var message = getMockMessages()[0];
    message.getId = function() {
      return 5;
    };

    messages.add(message);
    assert(currentLatest !== messages.latest);
    done();
  });

  it('should support marking message as read', function(done) {
    messages.current()
      .then(function(message) {
        messages.markAsRead(message);
        assert(message.read);
        checkSuccess();
      })
      .done();

    function checkSuccess() {
      setTimeout(function() {
        var changeFolder = operations[operations.length - 1];
        var markAsRead = operations[operations.length - 2];

        if (changeFolder === 'changeFolder' &&
            markAsRead === 'markAsRead' && mwiUpdated) {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support removing a message', function(done) {
    messages.current()
      .then(function(message) {
        messages.remove(message);

        return messages.current()
          .then(function(current) {
            assert(current.getId() !== message.getId());
            assert(messages.getCount() === 4);
            done();
          });
      })
      .done();
  });

  it('should support deleting a message', function(done) {
    messages.delete()
      .then(function() {
        checkSuccess();
      })
      .done();

    function checkSuccess() {
      setTimeout(function() {
        var remove = operations[operations.length - 1];

        if (remove === 'remove' && mwiUpdated && recordingDeleted) {
          assert(messages.getCount() === 3);
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support calculating a menu', function(done) {
    messages.next()
      .then(function() {
        return messages.next();
      })
      .then(function() {
        var menu = messages.calculateMenu();

        assert(menu[0] === 'menuPrev');
        assert(menu[1] === 'menuRepeat');
        assert(menu[2] === 'menuNext');
        assert(menu[3] === 'menuDelete');

        done();
      })
      .done();
  });

  it('should support changing folder', function(done) {
    var folder = getMockFolders()[1];

    messages.changeFolder(folder.dtmf)
      .then(function() {
        assert(messages.getCount() === 4);

        var currentFolder =  messages.getCurrentFolder();
        assert(currentFolder.name === folder.name);

        done();
      })
      .done();
  });
});
