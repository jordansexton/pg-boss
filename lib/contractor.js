'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var assert = require('assert');
var plans = require('./plans');
var migrations = require('./migrations');
var schemaVersion = require('../version.json').schema;
var Promise = require("bluebird");

var Contractor = function () {
    _createClass(Contractor, null, [{
        key: 'constructionPlans',
        value: function constructionPlans(schema) {
            var exportPlans = plans.create(schema);
            exportPlans.push(plans.insertVersion(schema).replace('$1', '\'' + schemaVersion + '\''));

            return exportPlans.join(';\n\n');
        }
    }, {
        key: 'migrationPlans',
        value: function migrationPlans(schema, version, uninstall) {
            var migration = migrations.get(schema, version, uninstall);
            assert(migration, 'migration not found from version ' + version + '. schema: ' + schema);
            return migration.commands.join(';\n\n');
        }
    }]);

    function Contractor(db, config) {
        _classCallCheck(this, Contractor);

        this.config = config;
        this.db = db;
    }

    _createClass(Contractor, [{
        key: 'version',
        value: function version() {
            return this.db.executeSql(plans.getVersion(this.config.schema)).then(function (result) {
                return result.rows.length ? result.rows[0].version : null;
            });
        }
    }, {
        key: 'isCurrent',
        value: function isCurrent() {
            return this.version().then(function (version) {
                return version === schemaVersion;
            });
        }
    }, {
        key: 'isInstalled',
        value: function isInstalled() {
            return this.db.executeSql(plans.versionTableExists(this.config.schema)).then(function (result) {
                return result.rows.length ? result.rows[0].name : null;
            });
        }
    }, {
        key: 'ensureCurrent',
        value: function ensureCurrent() {
            var _this = this;

            return this.version().then(function (version) {
                if (schemaVersion !== version) return _this.update(version);
            });
        }
    }, {
        key: 'create',
        value: function create() {
            var _this2 = this;

            return Promise.each(plans.create(this.config.schema), function (command) {
                return _this2.db.executeSql(command);
            }).then(function () {
                return _this2.db.executeSql(plans.insertVersion(_this2.config.schema), schemaVersion);
            });
        }
    }, {
        key: 'update',
        value: function update(current) {
            var _this3 = this;

            if (current == '0.0.2') current = '0.0.1';

            return this.db.migrate(current).then(function (version) {
                if (version !== schemaVersion) return _this3.update(version);
            });
        }
    }, {
        key: 'start',
        value: function start() {
            var _this4 = this;

            return this.isInstalled().then(function (installed) {
                return installed ? _this4.ensureCurrent() : _this4.create();
            });
        }
    }, {
        key: 'connect',
        value: function connect() {
            var _this5 = this;

            var connectErrorMessage = 'this version of pg-boss does not appear to be installed in your database. I can create it for you via start().';

            return this.isInstalled().then(function (installed) {
                if (!installed) throw new Error(connectErrorMessage);

                return _this5.isCurrent();
            }).then(function (current) {
                if (!current) throw new Error(connectErrorMessage);
            });
        }
    }]);

    return Contractor;
}();

module.exports = Contractor;