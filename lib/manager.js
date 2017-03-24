'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var assert = require('assert');
var EventEmitter = require('events');
var Promise = require('bluebird');
var uuid = require('uuid');

var Worker = require('./worker');
var plans = require('./plans');
var Attorney = require('./attorney');

var Manager = function (_EventEmitter) {
    _inherits(Manager, _EventEmitter);

    function Manager(db, config) {
        _classCallCheck(this, Manager);

        var _this = _possibleConstructorReturn(this, (Manager.__proto__ || Object.getPrototypeOf(Manager)).call(this));

        _this.config = config;
        _this.db = db;

        _this.nextJobCommand = plans.fetchNextJob(config.schema);
        _this.expireJobCommand = plans.expireJob(config.schema);
        _this.insertJobCommand = plans.insertJob(config.schema);
        _this.completeJobCommand = plans.completeJob(config.schema);
        _this.cancelJobCommand = plans.cancelJob(config.schema);

        _this.workers = [];
        return _this;
    }

    _createClass(Manager, [{
        key: 'monitor',
        value: function monitor() {
            var self = this;

            return expire().then(init);

            function expire() {
                return self.db.executeSql(self.expireJobCommand).then(function (result) {
                    if (result.rowCount) self.emit('expired', result.rowCount);
                });
            }

            function init() {
                if (self.stopped) return;

                self.expireTimer = setTimeout(check, self.config.expireCheckInterval);

                function check() {
                    expire().catch(function (error) {
                        return self.emit('error', error);
                    }).then(init);
                }
            }
        }
    }, {
        key: 'close',
        value: function close() {
            this.workers.forEach(function (worker) {
                return worker.stop();
            });
            this.workers.length = 0;
            return Promise.resolve(true);
        }
    }, {
        key: 'stop',
        value: function stop() {
            var _this2 = this;

            this.close().then(function () {
                _this2.stopped = true;

                if (_this2.expireTimer) clearTimeout(_this2.expireTimer);
            });
        }
    }, {
        key: 'subscribe',
        value: function subscribe(name) {
            for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
            }

            var self = this;

            return getArgs(args).then(function (_ref) {
                var options = _ref.options,
                    callback = _ref.callback;
                return register(options, callback);
            });

            function getArgs(args) {

                var options = void 0,
                    callback = void 0;

                try {
                    assert(name, 'boss requires all jobs to have a name');

                    if (args.length === 1) {
                        callback = args[0];
                        options = {};
                    } else if (args.length === 2) {
                        options = args[0] || {};
                        callback = args[1];
                    }

                    assert(typeof callback == 'function', 'expected a callback function');

                    if (options) assert((typeof options === 'undefined' ? 'undefined' : _typeof(options)) == 'object', 'expected config to be an object');

                    options = options || {};
                    options.teamSize = options.teamSize || 1;

                    if ('newJobCheckInterval' in options || 'newJobCheckIntervalSeconds' in options) options = Attorney.applyNewJobCheckInterval(options);else options.newJobCheckInterval = self.config.newJobCheckInterval;
                } catch (e) {
                    return Promise.reject(e);
                }

                return Promise.resolve({ options: options, callback: callback });
            }

            function register(options, callback) {

                var onError = function onError(error) {
                    return self.emit('error', error);
                };

                var onJob = function onJob(job) {
                    if (!job) return;
                    self.emit('job', job);
                    setImmediate(function () {
                        try {
                            callback(job, function () {
                                return self.complete(job.id);
                            });
                        } catch (error) {
                            onError(error);
                        }
                    });
                };

                var onFetch = function onFetch() {
                    return self.fetch(name);
                };

                var workerConfig = {
                    name: name,
                    fetcher: onFetch,
                    responder: onJob,
                    error: onError,
                    interval: options.newJobCheckInterval
                };

                for (var w = 0; w < options.teamSize; w++) {
                    var worker = new Worker(workerConfig);
                    worker.start();
                    self.workers.push(worker);
                }
            }
        }
    }, {
        key: 'publish',
        value: function publish() {
            for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
                args[_key2] = arguments[_key2];
            }

            var self = this;

            return getArgs(args).then(function (_ref2) {
                var name = _ref2.name,
                    data = _ref2.data,
                    options = _ref2.options;
                return insertJob(name, data, options);
            });

            function getArgs(args) {
                var name = void 0,
                    data = void 0,
                    options = void 0;

                try {
                    if (typeof args[0] == 'string') {

                        name = args[0];
                        data = args[1];

                        assert(typeof data != 'function', 'publish() cannot accept a function as the payload.  Did you intend to use subscribe()?');

                        options = args[2];
                    } else if (_typeof(args[0]) == 'object') {

                        assert(args.length === 1, 'publish object API only accepts 1 argument');

                        var job = args[0];

                        assert(job, 'boss requires all jobs to have a name');

                        name = job.name;
                        data = job.data;
                        options = job.options;
                    }

                    options = options || {};

                    assert(name, 'boss requires all jobs to have a name');
                    assert((typeof options === 'undefined' ? 'undefined' : _typeof(options)) == 'object', 'options should be an object');
                } catch (error) {
                    return Promise.reject(error);
                }

                return Promise.resolve({ name: name, data: data, options: options });
            }

            function insertJob(name, data, options, singletonOffset) {
                var startIn = options.startIn > 0 ? '' + options.startIn : typeof options.startIn == 'string' ? options.startIn : '0';

                var singletonSeconds = options.singletonSeconds > 0 ? options.singletonSeconds : options.singletonMinutes > 0 ? options.singletonMinutes * 60 : options.singletonHours > 0 ? options.singletonHours * 60 * 60 : options.singletonDays > 0 ? options.singletonDays * 60 * 60 * 24 : null;

                var id = uuid[self.config.uuid](),
                    retryLimit = options.retryLimit || 0,
                    expireIn = options.expireIn || '15 minutes';

                var singletonKey = options.singletonKey || null;

                var values = [id, name, retryLimit, startIn, expireIn, data, singletonKey, singletonSeconds, singletonOffset || 0];

                return self.db.executeSql(self.insertJobCommand, values).then(function (result) {
                    if (result.rowCount === 1) return id;

                    if (!options.singletonNextSlot) return null;

                    // delay starting by the offset to honor throttling config
                    options.startIn = singletonSeconds;
                    // toggle off next slot config for round 2
                    options.singletonNextSlot = false;

                    var singletonOffset = singletonSeconds;

                    return insertJob(name, data, options, singletonOffset);
                });
            }
        }
    }, {
        key: 'fetch',
        value: function fetch(name) {
            return this.db.executeSql(this.nextJobCommand, name).then(function (result) {
                if (result.rows.length === 0) return null;

                var job = result.rows[0];

                job.name = name;

                return job;
            });
        }
    }, {
        key: 'complete',
        value: function complete(id) {
            return this.db.executeSql(this.completeJobCommand, [id]).then(function (result) {
                assert(result.rowCount === 1, 'Job ' + id + ' could not be completed.');
                return id;
            });
        }
    }, {
        key: 'cancel',
        value: function cancel(id) {
            return this.db.executeSql(this.cancelJobCommand, [id]).then(function (result) {
                assert(result.rowCount === 1, 'Job ' + id + ' could not be cancelled.');
                return id;
            });
        }
    }]);

    return Manager;
}(EventEmitter);

module.exports = Manager;