const EventEmitter = require('events');

class GPSEmitter extends EventEmitter {}

// Singleton emitter used across the app
const gpsEmitter = new GPSEmitter();

module.exports = gpsEmitter;
