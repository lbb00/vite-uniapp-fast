'use strict';

var optcExtPlugin = require('./optc-ext-plugin-D12FpWix.cjs');
require('node:crypto');
require('node:fs');
require('node:path');
require('@vue/compiler-sfc');
require('node:perf_hooks');



exports.createOptCExtPlugin = optcExtPlugin.createOptCExtPlugin;
exports.extractTemplateComponentTags = optcExtPlugin.extractTemplateComponentTags;
exports.loadEasycomConfig = optcExtPlugin.loadEasycomConfig;
exports.resolveEasycomTag = optcExtPlugin.resolveEasycomTag;
exports.seedEasycomIntoFingerprints = optcExtPlugin.seedEasycomIntoFingerprints;
