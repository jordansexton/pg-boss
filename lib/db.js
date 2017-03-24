'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var EventEmitter = require('events');
var pg = require('pg');
var Promise = require("bluebird");
var migrations = require('./migrations');
var url = require('url');

var Db = function (_EventEmitter) {
    _inherits(Db, _EventEmitter);

    function Db(config) {
        _classCallCheck(this, Db);

        var _this = _possibleConstructorReturn(this, (Db.__proto__ || Object.getPrototypeOf(Db)).call(this));

        _this.config = config;

        var poolConfig = config.connectionString ? parseConnectionString(config.connectionString) : config;

        _this.pool = new pg.Pool({
            user: poolConfig.user,
            password: poolConfig.password,
            host: poolConfig.host,
            port: poolConfig.port,
            database: poolConfig.database,
            application_name: poolConfig.application_name || 'pgboss',
            max: poolConfig.poolSize,
            Promise: Promise
        });

        _this.pool.on('error', function (error) {
            return _this.emit('error', error);
        });

        function parseConnectionString(connectionString) {
            var params = url.parse(connectionString);
            var auth = params.auth.split(':');

            return {
                user: auth[0],
                password: auth[1],
                host: params.hostname,
                port: params.port,
                database: params.pathname.split('/')[1],
                application_name: params.application_name || 'pgboss'
            };
        }
        return _this;
    }

    _createClass(Db, [{
        key: 'executeSql',
        value: function executeSql(text, values) {
            if (values && !Array.isArray(values)) values = [values];

            return this.pool.query(text, values);
        }
    }, {
        key: 'migrate',
        value: function migrate(version, uninstall) {
            var _this2 = this;

            var migration = migrations.get(this.config.schema, version, uninstall);

            if (!migration) {
                var errorMessage = 'Migration to version ' + version + ' failed because it could not be found.  Your database may have been upgraded by a newer version of pg-boss';
                return Promise.reject(new Error(errorMessage));
            }

            return Promise.each(migration.commands, function (command) {
                return _this2.executeSql(command);
            }).then(function () {
                return migration.version;
            });
        }
    }]);

    return Db;
}(EventEmitter);

module.exports = Db;