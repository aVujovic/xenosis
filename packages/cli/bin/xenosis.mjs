#!/usr/bin/env node
// Delegate to the compiled CLI entry. Shipping built JS (no tsx/ts-node at
// runtime) keeps the global install dependency-free and fast.
import './../dist/index.js';
