/**
 * Mailbox reader module unit tests.
 *
 * @module tests-mailbox-reader
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global before:false*/
/*global after:false*/
/*global it:false*/

var mockery = require('mockery');
var Q = require('q');
var assert = require('assert');
var util = require('util');
var Emitter = require('events').EventEmitter;

var mockClient;
// used to keep track of messages helper operations
var operations = [];
// used to test whether or not the prompt finished
var promptFinished = false;
// used to test whether or not the prompt was stopped
var promptStopped = false;
// milliseconds to delay async ops for mock requests
var asyncDelay = 50;
// milliseconds to delay for async ops that should take longer
var longAsyncDelay = 300;
var mockeryOpts = {
  warnOnReplace: false,
  warnOnUnregistered: false,
  useCleanCache: true
};

/**
 * Returns a mock client that also acts as a Channel instance
 * to allow a single EventEmitter to be used for testing.
 *
 * The mock client is cached so tests can access it to emit events if
 * necessary.
 */
var getMockClient = function(createNew) {

  if (mockClient && createNew !== true) {
    return mockClient;
  }

  var Client = function() {
    this.getChannel = function() {
      return this;
    };
  };
  util.inherits(Client, Emitter);

  mockClient = new Client();

  return mockClient;
};

/**
 * Returns a mock config for testing.
 */
var getMockConfig = function() {
  return {
    getAppConfig: function() {
      return {
        prompts: {
          mailboxReader: {
            menuFirst: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            introMessages: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            introNoMessages: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            messageDeleted: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            changeFolder: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            noMore: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            messageInfoPre: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            message: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],

            invalidFolder: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }],
          }
        }
      };
    }
  };
};

/**
 * Returns a mock messages helper for testing.
 */
var getMockMessages = function() {
  return {
    create: function(mailbox, folders, currentFolder, dependencies) {
      return {
        calculateMenu: function() {
          operations.push('calculateMenu');
          return ['menuFirst'];
        },

        load: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('load');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        isNotEmpty: function() {
          operations.push('isNotEmpty');
          return true;
        },

        getCount: function() {
          operations.push('getCount');
          return 5;
        },

        manyExist: function() {
          operations.push('manyExist');
          return true;
        },

        getCurrentFolder: function() {
          operations.push('getCurrentFolder');
          return currentFolder;
        },

        'delete': function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('delete');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        getOrder: function() {
          operations.push('getOrder');
          return 1;
        },

        markAsRead: function() {
          operations.push('markAsRead');
        },

        changeFolder: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('changeFolder');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        first: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('first');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        current: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('current');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        next: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('next');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        prev: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            operations.push('prev');
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        }
      };
    }
  };
};

/**
 * Returns a mock dal for testing.
 */
var getMockDal = function() {
  var dal = {
    folder: {
      all: function() {
        var innerDeferred = Q.defer();

        setTimeout(function() {
          innerDeferred.resolve([{name: 'Inbox'}]);
        }, asyncDelay);

        return innerDeferred.promise;
      }
    }
  };
  
  return dal;
};

/**
 * Returns a mock prompt helper for testing.
 */
var getMockPrompt = function() {
  var promptHelper = {
    create: function(sounds, channel) {
      if (!sounds || !channel) {
        throw new Error('missing arguments');
      }

      return {
        play: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            var completed = (!promptStopped) ? true: false;
            innerDeferred.resolve(completed);
            promptFinished = true;
          }, asyncDelay);

          return innerDeferred.promise;
        },

        stop: function() {
          promptStopped = true;
        }
      };
    }
  };

  return promptHelper;
};

/**
 * Returns a mock mailbox for testing.
 */
var getMockMailbox = function() {
  var mailbox = {
    getId: function() {
      return 1;
    }
  };
  
  return mailbox;
};

/**
 * Returns a mock logger for testing.
 */
var getMockLogger = function() {
  return {
    child: function() {
      return {
        trace: function() {},
        debug: function() {},
        info: function() {},
        warn: function() {},
        error: function() {},
        fatal: function() {}
      };
    }
  };
};

/**
 * Returns mock dependencies for testing.
 */
var getMockDependencies = function() {
  return {
    dal: getMockDal(),
    prompt: getMockPrompt(),
    config: getMockConfig(),
    logger: getMockLogger()
  };
};

describe('mailbox reader', function() {

  before(function(done) {
    mockery.enable(mockeryOpts);
    mockery.registerMock('./helpers/messages.js', getMockMessages());

    done();
  });

  after(function(done) {
    mockery.disable();

    done();
  });

  afterEach(function(done) {
    operations = [];
    promptFinished = false;
    promptStopped = false;
    getMockClient().emit('StasisEnd');

    done();
  });

  it('should support playing first message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.first();
    checkSuccess();

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'first') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support playing next message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.next();
    checkSuccess();

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'next') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support replaying current message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.next();
    setTimeout(function() {
      mailboxHelper.replay();
      checkSuccess();
    }, longAsyncDelay);

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'current') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support playing previous message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.prev();
    checkSuccess();

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'prev') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support stopping message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.next();
    setTimeout(function() {
      mailboxHelper.replay();
      checkSuccess();
    }, asyncDelay);

    function checkSuccess() {
      setTimeout(function() {
        if (promptStopped && operations.pop() === 'current') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support deleting current message', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.next();
    setTimeout(function() {
      mailboxHelper.delete();
      checkSuccess();
    }, asyncDelay);

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'delete') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

  it('should support changing folders', function(done) {
    var channel = getMockClient(true).getChannel();
    var mailboxHelper = require('../lib/mailbox.js')(getMockDependencies())
      .createReader(getMockMailbox(), channel);

    mailboxHelper.next();
    setTimeout(function() {
      mailboxHelper.changeFolder();

      setTimeout(function() {
        mailboxHelper.submitFolder('1');
        checkSuccess();
      }, asyncDelay);
    }, asyncDelay);

    function checkSuccess() {
      setTimeout(function() {
        if (promptFinished && operations.pop() === 'changeFolder') {
          done();
        } else {
          checkSuccess();
        }
      }, asyncDelay);
    }
  });

});
