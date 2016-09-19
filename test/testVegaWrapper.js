'use strict';

var assert = require('assert'),
    _ = require('underscore'),
    util = require('util'),
    urllib = require('url'),
    VegaWrapper = require('../src/VegaWrapper');

describe('vegaWrapper', function() {

    /**
     * This is a copy of the vega2.js parseUrl code. If updated here, make sure to copy it there as well.
     * It is not easy to reuse it because current lib should be browser vs nodejs agnostic,
     * @param opt
     * @return {*}
     */
    function parseUrl(opt) {
        var url = opt.url;
        var isRelativeUrl = url[0] === '/' && url[1] === '/';
        if (isRelativeUrl) {
            // Workaround: urllib does not support relative URLs, add a temp protocol
            url = 'temp:' + url;
        }
        var urlParts = urllib.parse(url, true);
        if (isRelativeUrl) {
            delete urlParts.protocol;
        }
        // reduce confusion, only keep expected values
        delete urlParts.hostname;
        delete urlParts.path;
        delete urlParts.href;
        delete urlParts.port;
        delete urlParts.search;
        if (!urlParts.host || urlParts.host === '') {
            urlParts.host = opt.domain;
            // for some protocols, default host name is resolved differently
            // this value is ignored by the urllib.format()
            urlParts.isRelativeHost = true;
        }

        return urlParts;
    }

    function expectError(testFunc, msg, errFuncNames) {
        var error, result;
        try {
            result = testFunc();
        } catch (err) {
            error = err;
        }

        if (!error) {
            assert(false, util.format('%j was expected to cause an error in functions %j, but returned %j',
                msg, errFuncNames, result));
        }

        if (error.stack.split('\n').map(function (v) {
                return v.trim().split(' ');
            }).filter(function (v) {
                return v[0] === 'at';
            })[0][1] in errFuncNames
        ) {
            // If first stack line (except the possibly multiline message) is not expected function, throw
            error.message = '"' + msg + '" caused an error:\n' + error.message;
            throw error;
        }
    }

    var domains = {
        http: ['nonsec.org'],
        https: ['sec.org'],
        wikiapi: ['wikiapi.nonsec.org', 'wikiapi.sec.org'],
        wikirest: ['wikirest.nonsec.org', 'wikirest.sec.org'],
        wikiraw: ['wikiraw.nonsec.org', 'wikiraw.sec.org'],
        wikirawupload: ['wikirawupload.nonsec.org', 'wikirawupload.sec.org'],
        wikidatasparql: ['wikidatasparql.nonsec.org', 'wikidatasparql.sec.org'],
        geoshape: ['geoshape.nonsec.org', 'geoshape.sec.org']
    };
    var domainMap = {
        'nonsec': 'nonsec.org',
        'sec': 'sec.org'
    };

    function createWrapper(useXhr, isTrusted) {
        var datalib = {
            extend: _.extend,
            load: {}
        };
        return new VegaWrapper(
            datalib, useXhr, isTrusted, domains, domainMap, function (msg) {
                throw new Error(msg);
            }, parseUrl, urllib.format);
    }

    it('sanitizeUrl - unsafe', function () {
        var wrapper = createWrapper(true, true),
            pass = function (url, expected) {
                assert.equal(wrapper.sanitizeUrl({url: url, domain: 'domain.sec.org'}), expected, url)
            },
            fail = function (url) {
                expectError(function () {
                    return wrapper.sanitizeUrl({url: url, domain: 'domain.sec.org'});
                }, url, ['VegaWrapper.sanitizeUrl']);
            };

        fail('nope://sec.org');
        fail('nope://sec');

        pass('', 'https://domain.sec.org');
        pass('blah', 'https://domain.sec.org/blah');
        pass('http://sec.org', 'http://sec.org/');
        pass('http://sec.org/blah?test=1', 'http://sec.org/blah?test=1');
        pass('http://any.sec.org', 'http://any.sec.org/');
        pass('http://any.sec.org/blah?test=1', 'http://any.sec.org/blah?test=1');
        pass('http://sec', 'http://sec.org/');
        pass('http://sec/blah?test=1', 'http://sec.org/blah?test=1');

    });

    it('sanitizeUrl - safe', function () {
        var wrapper = createWrapper(true, false),
            pass = function (url, expected, addCorsOrigin) {
                var opt = {url: url, domain: 'domain.sec.org'};
                assert.equal(wrapper.sanitizeUrl(opt), expected, url);
                assert.equal(!!opt.addCorsOrigin, !!addCorsOrigin, 'addCorsOrigin');
            },
            passWithCors = function (url, expected) {
                return pass(url, expected, true);
            },
            fail = function (url) {
                expectError(function () {
                    return wrapper.sanitizeUrl({url: url, domain: 'domain.sec.org'});
                }, url, ['VegaWrapper.sanitizeUrl', 'VegaWrapper._validateExternalService']);
            };

        fail('');
        fail('blah');
        fail('nope://sec.org');
        fail('nope://sec');
        fail('https://sec.org');
        fail('https://sec');

        // wikiapi allows sub-domains
        passWithCors('wikiapi://sec.org?a=1', 'https://sec.org/w/api.php?a=1&format=json&formatversion=2');
        passWithCors('wikiapi://wikiapi.sec.org?a=1', 'https://wikiapi.sec.org/w/api.php?a=1&format=json&formatversion=2');
        passWithCors('wikiapi://sec?a=1', 'https://sec.org/w/api.php?a=1&format=json&formatversion=2');
        passWithCors('wikiapi://nonsec.org?a=1', 'http://nonsec.org/w/api.php?a=1&format=json&formatversion=2');
        passWithCors('wikiapi://wikiapi.nonsec.org?a=1', 'http://wikiapi.nonsec.org/w/api.php?a=1&format=json&formatversion=2');
        passWithCors('wikiapi://nonsec?a=1', 'http://nonsec.org/w/api.php?a=1&format=json&formatversion=2');

        // wikirest allows sub-domains, requires path to begin with "/api/"
        fail('wikirest://sec.org');
        pass('wikirest:///api/abc', 'https://domain.sec.org/api/abc');
        pass('wikirest://sec.org/api/abc', 'https://sec.org/api/abc');
        pass('wikirest://sec/api/abc', 'https://sec.org/api/abc');
        pass('wikirest://wikirest.sec.org/api/abc', 'https://wikirest.sec.org/api/abc');
        pass('wikirest://wikirest.nonsec.org/api/abc', 'http://wikirest.nonsec.org/api/abc');

        // wikiraw allows sub-domains
        fail('wikiraw://sec.org');
        fail('wikiraw://sec.org/');
        fail('wikiraw://sec.org/?a=10');
        fail('wikiraw://asec.org/aaa');
        fail('wikiraw:///abc|xyz');
        fail('wikiraw://sec.org/abc|xyz');
        passWithCors('wikiraw:///abc', 'https://domain.sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=abc');
        passWithCors('wikiraw:///abc/xyz', 'https://domain.sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=abc%2Fxyz');
        passWithCors('wikiraw://sec.org/aaa', 'https://sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=aaa');
        passWithCors('wikiraw://sec.org/aaa?a=10', 'https://sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=aaa');
        passWithCors('wikiraw://sec.org/abc/def', 'https://sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=abc%2Fdef');
        passWithCors('wikiraw://sec/aaa', 'https://sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=aaa');
        passWithCors('wikiraw://sec/abc/def', 'https://sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=abc%2Fdef');
        passWithCors('wikiraw://wikiraw.sec.org/abc', 'https://wikiraw.sec.org/w/api.php?format=json&formatversion=2&action=query&prop=revisions&rvprop=content&titles=abc');

        fail('wikirawupload://sec.org');
        fail('wikirawupload://sec.org/');
        fail('wikirawupload://sec.org/a');
        fail('wikirawupload://sec.org/?a=10');
        fail('wikirawupload://asec.org/aaa');
        fail('wikirawupload://asec.org/aaa');
        fail('wikirawupload://asec.org/aaa');
        pass('wikirawupload:///aaa', 'http://wikirawupload.nonsec.org/aaa');
        pass('wikirawupload:///aaa/bbb', 'http://wikirawupload.nonsec.org/aaa/bbb');
        pass('wikirawupload:///aaa?a=1', 'http://wikirawupload.nonsec.org/aaa');
        pass('wikirawupload://wikirawupload.nonsec.org/aaa', 'http://wikirawupload.nonsec.org/aaa');
        fail('wikirawupload://blah.nonsec.org/aaa');
        fail('wikirawupload://a.wikirawupload.nonsec.org/aaa');

        fail('wikidatasparql://sec.org');
        fail('wikidatasparql://sec.org/');
        fail('wikidatasparql://sec.org/a');
        fail('wikidatasparql://sec.org/?a=10');
        fail('wikidatasparql://asec.org/aaa');
        fail('wikidatasparql://asec.org/aaa');
        fail('wikidatasparql://asec.org/aaa');
        fail('wikidatasparql:///aaa');
        fail('wikidatasparql:///?aquery=1');
        pass('wikidatasparql:///?query=1', 'http://wikidatasparql.nonsec.org/bigdata/namespace/wdq/sparql?query=1');
        pass('wikidatasparql://wikidatasparql.sec.org/?query=1', 'https://wikidatasparql.sec.org/bigdata/namespace/wdq/sparql?query=1');
        pass('wikidatasparql://wikidatasparql.sec.org/?query=1&blah=2', 'https://wikidatasparql.sec.org/bigdata/namespace/wdq/sparql?query=1');

        fail('geoshape://sec.org');
        fail('geoshape://sec.org/');
        fail('geoshape://sec.org/a');
        fail('geoshape://sec.org/?a=10');
        fail('geoshape://asec.org/aaa');
        fail('geoshape://asec.org/aaa');
        fail('geoshape://asec.org/aaa');
        fail('geoshape:///aaa');
        fail('geoshape:///?aquery=1');
        pass('geoshape:///?ids=1', 'http://geoshape.nonsec.org/shape?ids=1');
        pass('geoshape://geoshape.sec.org/?ids=a1,b4', 'https://geoshape.sec.org/shape?ids=a1%2Cb4');

        pass('wikifile:///Einstein_1921.jpg', 'https://domain.sec.org/wiki/Special:Redirect/file/Einstein_1921.jpg');
        pass('wikifile:///Einstein_1921.jpg?width=10', 'https://domain.sec.org/wiki/Special:Redirect/file/Einstein_1921.jpg?width=10');
        pass('wikifile://sec.org/Einstein_1921.jpg', 'https://sec.org/wiki/Special:Redirect/file/Einstein_1921.jpg');
    });

    it('sanitizeUrl for type=open', function () {
        var wrapper = createWrapper(true, false),
            pass = function (url, expected) {
                assert.equal(wrapper.sanitizeUrl({url: url, type: 'open', domain: 'domain.sec.org'}), expected, url)
            },
            fail = function (url) {
                expectError(function () {
                    return wrapper.sanitizeUrl({url: url, type: 'open', domain: 'domain.sec.org'});
                }, url, ['VegaWrapper.sanitizeUrl', 'VegaWrapper._validateExternalService']);
            };

        fail('wikiapi://sec.org?a=1');
        fail('wikirest:///api/abc');
        fail('///My%20page?foo=1');

        pass('wikititle:///My%20page', 'https://domain.sec.org/wiki/My_page');
        pass('///My%20page', 'https://domain.sec.org/wiki/My_page');
        pass('wikititle://sec.org/My%20page', 'https://sec.org/wiki/My_page');
        pass('//my.sec.org/My%20page', 'https://my.sec.org/wiki/My_page');

        // This is not a valid title, but it will get validated on the MW side
        pass('////My%20page', 'https://domain.sec.org/wiki/%2FMy_page');

        pass('http:///wiki/Http%20page', 'https://domain.sec.org/wiki/Http_page');
        pass('https:///wiki/Http%20page', 'https://domain.sec.org/wiki/Http_page');
        pass('http://my.sec.org/wiki/Http%20page', 'https://my.sec.org/wiki/Http_page');
        pass('https://my.sec.org/wiki/Http%20page', 'https://my.sec.org/wiki/Http_page');

        fail('http:///Http%20page');
        fail('https:///w/Http%20page');
        fail('https:///wiki/Http%20page?a=1');
    });

    it('dateParser', function () {
        var wrapper = createWrapper(),
            pass = function (expected, data, graphProtocol, dontEncode) {
                assert.deepStrictEqual(
                    wrapper.parseDataOrThrow(
                        dontEncode ? data : JSON.stringify(data),
                        {graphProtocol: graphProtocol}),
                    expected, graphProtocol)
            },
            fail = function (data, graphProtocol) {
                expectError(function () {
                    return wrapper.parseDataOrThrow(
                        dontEncode ? data : JSON.stringify(data),
                        {graphProtocol: graphProtocol});
                }, graphProtocol, ['VegaWrapper.parseDataOrThrow']);
            };

        fail(undefined, undefined, new Error());

        pass(1, 1, 'test:', true);

        fail({error: 'blah'}, 'wikiapi:');
        pass({blah: 1}, {blah: 1}, 'wikiapi:');

        fail({error: 'blah'}, 'wikiraw:');
        fail({blah: 1}, 'wikiraw:');
        pass('blah', {query: {pages: [{revisions: [{content: 'blah'}]}]}}, 'wikiraw:');

        fail({error: 'blah'}, 'wikidatasparql:');
        fail({blah: 1}, 'wikidatasparql:');
        fail({results: false}, 'wikidatasparql:');
        fail({results: {bindings: false}}, 'wikidatasparql:');
        pass([], {results: {bindings: []}}, 'wikidatasparql:');
        pass([{int: 42, float: 42.5, geo: [42, 144.5]}, {uri: 'Q42'}], {
            results: {
                bindings: [{
                    int: {
                        type: 'literal',
                        'datatype': 'http://www.w3.org/2001/XMLSchema#int',
                        value: '42'
                    },
                    float: {
                        type: 'literal',
                        'datatype': 'http://www.w3.org/2001/XMLSchema#float',
                        value: '42.5'
                    },
                    geo: {
                        type: 'literal',
                        'datatype': 'http://www.opengis.net/ont/geosparql#wktLiteral',
                        value: 'Point(42 144.5)'
                    }
                }, {
                    uri: {
                        type: 'uri',
                        value: 'http://www.wikidata.org/entity/Q42'
                    }
                }]
            }
        }, 'wikidatasparql:');
    });

});
