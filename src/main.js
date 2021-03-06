/**
 * The main entrypoint for our react-component render server.
 */

'use strict';

const argparse = require("argparse");

const packageInfo = require("../package.json");

const parser = new argparse.ArgumentParser({
    version: packageInfo.version,
    addHelp: true,
    description: packageInfo.description,
});
parser.addArgument(['-p', '--port'],
                   {type: 'int', defaultValue: 8060,
                    help: "Port to run on."});
parser.addArgument(['--dev'],
                   {action: 'storeTrue',
                    help: "Set if running on dev; controls caching/etc."});
parser.addArgument(['--cache-size'],
                   {type: 'int', defaultValue: 100,
                    help: "Internal cache size, in MB."});
parser.addArgument(['--log-level'],
                   {defaultValue: 'info',
                    choices: ['silly', 'debug', 'verbose', 'info',
                              'warn', 'error'],
                    help: "What level to log at."});

const args = parser.parseArgs();

if (!args.dev) {
    // Start logging agent for Cloud Trace (https://cloud.google.com/trace/).
    // We need to do this as soon as possible so it can patch future requires.
    const traceAgent = require('@google-cloud/trace-agent');
    traceAgent.start({logLevel: 3});  // log at INFO
}


// Now that cloud trace is set up, we can require() everything else.
const express = require("express");
const expressWinston = require('express-winston');
const winston = require('winston');

const app = require("./server.js");
const cache = require("./cache.js");
const fetchPackage = require("./fetch_package.js");
const render = require("./render.js");
const renderSecret = require("./secret.js");

const logging = winston;     // just an alias, for clarity

const port = args.port;

// Set up our globals and singletons
if (args.dev) {
    // In dev, we do an if-modified-since query rather than trusting
    // the cache never gets out of date.  (In prod the default cache
    // behavior is fine because package-names include their md5 in the
    // filename.)
    fetchPackage.setDefaultCacheBehavior('ims');
    render.setDefaultCacheBehavior('ignore');
    // We also turn off the timeout in dev; it's not as important there.
    fetchPackage.setTimeout(null);
    // Disable the need for secrets.
    renderSecret.matches = (actual, callback) => {
      return callback(null, true);
    };

    process.env.NODE_ENV = 'dev';
} else {
    // This is important for the default catch-all error handler:
    // http://expressjs.com/en/guide/error-handling.html
    process.env.NODE_ENV = 'production';
}

// Add logging support, based on
//   https://cloud.google.com/nodejs/getting-started/logging-application-events
winston.level = args.log_level;
const appWithLogging = express();
appWithLogging.use(expressWinston.logger({      // request logging
    transports: [
        new winston.transports.Console({
            json: false,
            colorize: args.dev,    // colorize for dev, but not prod
        }),
    ],
    expressFormat: true,
    meta: false,
}));
appWithLogging.use(expressWinston.errorLogger({      // error logging
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: args.dev,
        }),
    ],
}));
appWithLogging.use(app);

cache.init(args.cacheSize * 1024 * 1024);

const server = appWithLogging.listen(port, () => {
    const host = server.address().address;
    const port = server.address().port;

    logging.info('react-render-server running at http://%s:%s', host, port);
});
