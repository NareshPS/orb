const gclean = require('gulp-clean')
const browserify = require('browserify')
const tap = require('gulp-tap')
const buffer = require('gulp-buffer')
const sourcemaps = require('gulp-sourcemaps')
// const terser = require('gulp-terser')
const { src, series, dest } = require("gulp")

const OUTPUT_DIR = 'dist'

/**
 * Bundles JS as browser consumable
 * 
 * Steps:
 * 1- Transform file objects using gulp-tap plugin
 * 2- Transform streaming contents into buffer contents (because gulp-sourcemaps does not support streaming contents)
 * 3- Load and init sourcemaps
 * 4- Write sourcemaps
 * 5- Write output
 */
const bundle = _ => src('src/index.js', {read: false}) // no need of reading file because browserify does.
.pipe(tap((file) => {
  file.contents = browserify(file.path, {debug: true}).bundle()
}))
.pipe(buffer())
.pipe(sourcemaps.init({loadMaps: true}))
.pipe(sourcemaps.write('./'))
.pipe(dest(OUTPUT_DIR))

/**
 * Creates output directory structure.
 */
const dirs = _ => src('*.*', {read: false})
.pipe(dest(`${OUTPUT_DIR}`))

/**
 * Cleans output
 */
const clean = _ => src(OUTPUT_DIR, {allowEmpty: true})
.pipe(gclean())

module.exports = {
  build: series(clean, dirs, bundle),
  clean: series(clean),
}