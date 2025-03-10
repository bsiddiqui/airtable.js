'use strict';

var internalConfig = require('./internal_config.json');
var objectToQueryParamString = require('./object_to_query_param_string');
var packageVersion = require('./package_version');

// This will become require('xhr') in the browser.
var request = require('request');

request.defaults({
  forever: true
})

var userAgent = 'Airtable.js/' + packageVersion;

// "Full Jitter" algorithm taken from https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
function exponentialBackoffWithJitter(numberOfRetries, initialBackoffTimeMs, maxBackoffTimeMs) {
    var rawBackoffTimeMs = initialBackoffTimeMs * Math.pow(2, numberOfRetries);
    var clippedBackoffTimeMs = Math.min(maxBackoffTimeMs, rawBackoffTimeMs);
    var jitteredBackoffTimeMs = Math.random() * clippedBackoffTimeMs;
    return jitteredBackoffTimeMs;
}

function runAction(base, method, path, queryParams, bodyData, callback, numAttempts) {
    var url = base._airtable._endpointUrl + '/v' + base._airtable._apiVersionMajor + '/' + base._id + path + '?' + objectToQueryParamString(queryParams);

    var headers = {
        'authorization': 'Bearer ' + base._airtable._apiKey,
        'x-api-version': base._airtable._apiVersion,
        'x-airtable-application-id': base.getId(),
    };
    var isBrowser = typeof window !== 'undefined';
    // Some browsers do not allow overriding the user agent.
    // https://github.com/Airtable/airtable.js/issues/52
    if (isBrowser) {
        headers['x-airtable-user-agent'] = userAgent;
    } else {
        headers['User-Agent'] = userAgent;
    }


    var options = {
        method: method.toUpperCase(),
        url: url,
        json: true,
        timeout: base._airtable.requestTimeout,
        headers: headers,
        // agentOptions are ignored when running in the browser.
        agentOptions: {
            rejectUnauthorized: base._airtable._allowUnauthorizedSsl
        },
    };

    if (bodyData !== null) {
        options.body = bodyData;
    }

    request(options, function(error, resp, body) {
        if (error) {
            callback(error, resp, body);
            return;
        }

        if (resp.statusCode === 429 && !base._airtable._noRetryIfRateLimited) {
            var backoffDelayMs = exponentialBackoffWithJitter(numAttempts, internalConfig.INITIAL_RETRY_DELAY_IF_RATE_LIMITED, internalConfig.MAX_RETRY_DELAY_IF_RATE_LIMITED);
            setTimeout(function() {
                runAction(base, method, path, queryParams, bodyData, callback, numAttempts + 1);
            }, backoffDelayMs);
            return;
        }

        error = base._checkStatusForError(resp.statusCode, body);
        callback(error, resp, body);
    });
}

module.exports = runAction;
