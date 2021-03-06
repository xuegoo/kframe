/* global AFRAME, THREE */

var anime = require('animejs');

AFRAME.anime = anime;

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

var colorHelperFrom = new THREE.Color();
var colorHelperTo = new THREE.Color();

var utils = AFRAME.utils;
var getComponentProperty = utils.entity.getComponentProperty;
var setComponentProperty = utils.entity.setComponentProperty;
var splitCache = {};

var TYPE_COLOR = 'color';
var PROP_POSITION = 'position';
var PROP_ROTATION = 'rotation';
var PROP_SCALE = 'scale';
var STRING_COMPONENTS = 'components';
var STRING_OBJECT3D = 'object3D';

/**
 * Animation component for A-Frame using anime.js.
 *
 * The component manually controls the tick by setting `autoplay: false` on anime.js and
 * manually * calling `animation.tick()` in the tick handler. To pause or resume, we toggle a
 * boolean * flag * `isAnimationPlaying`.
 *
 * anime.js animation config for tweenining Javascript objects and values works as:
 *
 *  config = {
 *    targets: {foo: 0.0, bar: '#000'},
 *    foo: 1.0,
 *    bar: '#FFF'
 *  }
 *
 * The above will tween each property in `targets`. The `to` values are set in the root of
 * the config.
 *
 * @member {object} animation - anime.js instance.
 * @member {boolean} animationIsPlaying - Control if animation is playing.
 */
AFRAME.registerComponent('animation', {
  schema: {
    autoplay: {default: true},
    delay: {default: 0},
    dir: {default: ''},
    dur: {default: 1000},
    easing: {default: 'easeInQuad'},
    elasticity: {default: 400},
    from: {default: ''},
    loop: {
      default: 0,
      parse: function (value) {
        // Boolean or integer.
        if (value === 'true') { return true; }
        if (value === 'false') { return false; }
        return parseInt(value, 10);
      }
    },
    property: {default: ''},
    startEvents: {type: 'array'},
    pauseEvents: {type: 'array'},
    resumeEvents: {type: 'array'},
    to: {default: ''},
    type: {default: ''},
    isRawProperty: {default: false}
  },

  multiple: true,

  init: function () {
    var self = this;

    this.eventDetail = {name: this.attrName};
    this.time = 0;

    this.animation = null;
    this.animationIsPlaying = false;
    this.onStartEvent = this.onStartEvent.bind(this);
    this.beginAnimation = this.beginAnimation.bind(this);
    this.pauseAnimation = this.pauseAnimation.bind(this);
    this.resumeAnimation = this.resumeAnimation.bind(this);

    this.fromColor = {};
    this.toColor = {};
    this.targets = {};
    this.targetsArray = [];

    this.config = {
      complete: function () {
        self.animationIsPlaying = false;
        self.el.emit('animationcomplete', self.eventDetail);
      }
    };
  },

  update: function () {
    var config = this.config;
    var data = this.data;

    this.animationIsPlaying = false;

    if (!data.property) { return; }

    // Base config.
    config.autoplay = false;
    config.direction = data.dir;
    config.duration = data.dur;
    config.easing = data.easing;
    config.elasticity = data.elasticity;
    config.loop = data.loop;

    // Start new animation.
    this.createAndStartAnimation();
  },

  tick: function (t, dt) {
    if (!this.animationIsPlaying) { return; }
    this.time += dt;
    this.animation.tick(this.time);
  },

  remove: function () {
    this.pauseAnimation();
    this.removeEventListeners();
  },

  pause: function () {
    this.paused = true;
    this.pausedWasPlaying = true;
    this.pauseAnimation();
    this.removeEventListeners();
  },

  /**
   * `play` handler only for resuming scene.
   */
  play: function () {
    if (!this.paused) { return; }
    this.paused = false;
    this.addEventListeners();
    if (this.pausedWasPlaying) {
      this.resumeAnimation();
      this.pausedWasPlaying = false;
    }
  },

  /**
   * Start animation from scratch.
   */
  createAndStartAnimation: function () {
    var data = this.data;

    this.updateConfig();
    this.animationIsPlaying = false;
    this.animation = anime(this.config);

    this.removeEventListeners();
    this.addEventListeners();

    // Wait for start events for animation.
    if (!data.autoplay || data.startEvents && data.startEvents.length) { return; }

    // Delay animation.
    if (data.delay) {
      setTimeout(this.beginAnimation, data.delay);
      return;
    }

    // Play animation.
    this.beginAnimation();
  },

  /**
   * This is before animation start (including from startEvents).
   * Set to initial state (config.from, time = 0, seekTime = 0).
   */
  beginAnimation: function () {
    this.updateConfig();
    this.time = 0;
    this.animation.seek(0);
    this.animationIsPlaying = true;
    this.stopRelatedAnimations();
    this.el.emit('animationbegin', this.eventDetail);
  },

  pauseAnimation: function () {
    this.animationIsPlaying = false;
  },

  resumeAnimation: function () {
    this.animationIsPlaying = true;
  },

  /**
   * startEvents callback.
   */
  onStartEvent: function () {
    // Include the delay before each start event.
    if (this.data.delay) {
      setTimeout(this.beginAnimation, this.data.delay);
      return;
    }
    this.beginAnimation();
  },

  /**
   * rawProperty: true and type: color;
   */
  updateConfigForRawColor: function () {
    var config = this.config;
    var data = this.data;
    var el = this.el;
    var from;
    var key;
    var to;

    from = data.from || getRawProperty(el, data.property);
    to = data.to;

    // Use r/g/b vector for color type.
    this.setColorConfig(from, to);
    from = this.fromColor;
    to = this.toColor;

    this.targetsArray.length = 0;
    this.targetsArray.push(from);
    config.targets = this.targetsArray;
    for (key in to) { config[key] = to[key]; }

    config.update = (function () {
      var lastValue = {};
      lastValue.r = from.r;
      lastValue.g = from.g;
      lastValue.b = from.b;

      return function (anim) {
        var value;
        value = anim.animatables[0].target;

        // For animation timeline.
          if (value.r === lastValue.r &&
              value.g === lastValue.g &&
              value.b === lastValue.b) { return; }

        setRawProperty(el, data.property, value, data.type);
      };
    })();
  },

  /**
   * Stuff property into generic `property` key.
   */
  updateConfigForDefault: function () {
    var config = this.config;
    var data = this.data;
    var el = this.el;
    var from;
    var key;
    var isBoolean;
    var isNumber;
    var to;

    from = data.from || (
      isRawProperty(data)
        ? getRawProperty(el, data.property)
        : getComponentProperty(el, data.property)
    );
    to = data.to;

    isNumber = !isNaN(from || to);
    if (isNumber) {
      from = parseFloat(from);
      to = parseFloat(to);
    } else {
      from = from ? from.toString() : from;
      to = to ? to.toString() : to;
    }

    // Convert booleans to integer to allow boolean flipping.
    isBoolean = to === 'true' || to === 'false';
    if (isBoolean) {
      from = data.from === 'true' ? 1 : 0;
      to = data.to === 'true' ? 1 : 0;
    }

    this.targets.aframeProperty = from;
    config.targets = this.targets;
    config.aframeProperty = to;
    config.update = (function () {
      var lastValue = from;
      return function (anim) {
        var value;
        value = anim.animatables[0].target.aframeProperty;

        // Need to do a last value check for animation timeline since all the tweening
        // begins simultaenously even if the value has not changed. Also better for perf
        // anyways.
        if (value === lastValue) { return; }
        lastValue = value;

        if (isBoolean) {
          value = value >= 1 ? true : false;
        }

        if (isRawProperty(data)) {
          setRawProperty(el, data.property, value, data.type);
        } else {
          setComponentProperty(el, data.property, value);
        }
      };
    })();
  },

  /**
   * Extend x/y/z/w onto the config.
   * Update vector by modifying object3D.
   */
  updateConfigForVector: function () {
    var config = this.config;
    var data = this.data;
    var el = this.el;
    var key;
    var from;
    var to;

    // Parse coordinates.
    from = data.from
      ? AFRAME.utils.coordinates.parse(data.from)  // If data.from defined, use that.
      : getComponentProperty(el, data.property);  // If data.from not defined, get on the fly.
    to = AFRAME.utils.coordinates.parse(data.to);

    // Animate rotation through radians.
    if (data.property === PROP_ROTATION) {
      toRadians(from);
      toRadians(to);
    }

    // Set to and from.
    this.targetsArray.length = 0;
    this.targetsArray.push(from);
    config.targets = this.targetsArray;
    for (key in to) { config[key] = to[key]; }

    // If animating object3D transformation, run more optimized updater.
    if (data.property === PROP_POSITION || data.property === PROP_ROTATION ||
        data.property === PROP_SCALE) {
      config.update = (function () {
        var lastValue = {};
        lastValue.x = from.x;
        lastValue.y = from.y;
        lastValue.z = from.z;

        return function (anim) {
          var value = anim.animatables[0].target;
          // For animation timeline.
          if (value.x === lastValue.x &&
              value.y === lastValue.y &&
              value.z === lastValue.z) { return; }
          lastValue.x = value.x;
          lastValue.y = value.y;
          lastValue.z = value.z;
          el.object3D[data.property].set(value.x, value.y, value.z);
        };
      })();
      return;
    }

    // Animating some vector.
    config.update = (function () {
      var lastValue = {};
      lastValue.x = from.x;
      lastValue.y = from.y;
      lastValue.z = from.z;

      return function (anim) {
        var value = anim.animations[0].target;
        // For animation timeline.
        if (value.x === lastValue.x &&
            value.y === lastValue.y &&
            value.z === lastValue.z) { return; }
        lastValue.x = value.x;
        lastValue.y = value.y;
        lastValue.z = value.z;
        setComponentProperty(el, data.property, value);
      }
    })();
  },

  /**
   * Update the config before each run.
   */
  updateConfig: function () {
    var propType;

    // Route config type.
    propType = getPropertyType(this.el, this.data.property);
    if (isRawProperty(this.data) && this.data.type === TYPE_COLOR) {
      this.updateConfigForRawColor();
    } else if (propType === 'vec2' || propType === 'vec3' || propType === 'vec4') {
      this.updateConfigForVector();
    } else {
      this.updateConfigForDefault();
    }
  },

  /**
   * Make sure two animations on the same property don't fight each other.
   * e.g., animation__mouseenter="property: material.opacity"
   *       animation__mouseleave="property: material.opacity"
   */
  stopRelatedAnimations: function () {
    var component;
    var componentName;
    for (componentName in this.el.components) {
      component = this.el.components[componentName];
      if (componentName === this.attrName) { continue; }
      if (component.name !== 'animation') { continue; }
      if (component.data.property !== this.data.property) { continue; }
      component.animationIsPlaying = false;
    }
  },

  addEventListeners: function () {
    var data = this.data;
    var el = this.el;
    addEventListeners(el, data.startEvents, this.onStartEvent);
    addEventListeners(el, data.pauseEvents, this.pauseAnimation);
    addEventListeners(el, data.resumeEvents, this.resumeAnimation);
  },

  removeEventListeners: function () {
    var data = this.data;
    var el = this.el;
    removeEventListeners(el, data.startEvents, this.onStartEvent);
    removeEventListeners(el, data.pauseEvents, this.pauseAnimation);
    removeEventListeners(el, data.resumeEvents, this.resumeAnimation);
  },

  setColorConfig: function (from, to) {
    colorHelperFrom.set(from);
    colorHelperTo.set(to);
    from = this.fromColor;
    to = this.toColor;
    from.r = colorHelperFrom.r;
    from.g = colorHelperFrom.g;
    from.b = colorHelperFrom.b;
    to.r = colorHelperTo.r;
    to.g = colorHelperTo.g;
    to.b = colorHelperTo.b;
  }
});

/**
 * Given property name, check schema to see what type we are animating.
 * We just care whether the property is a vector.
 */
function getPropertyType (el, property) {
  var component;
  var componentName;
  var split;
  var propertyName;

  split = property.split('.');
  componentName = split[0];
  propertyName = split[1];
  component = el.components[componentName] || AFRAME.components[componentName];

  // Primitives.
  if (!component) { return null; }

  // Dynamic schema. We only care about vectors anyways.
  if (propertyName && !component.schema[propertyName]) { return null; }

  // Multi-prop.
  if (propertyName) { return component.schema[propertyName].type; }

  // Single-prop.
  return component.schema.type;
}

/**
 * Convert object to radians.
 */
function toRadians (obj) {
  obj.x = THREE.Math.degToRad(obj.x);
  obj.y = THREE.Math.degToRad(obj.y);
  obj.z = THREE.Math.degToRad(obj.z);
}

function addEventListeners (el, eventNames, handler) {
  var i;
  for (i = 0; i < eventNames.length; i++) {
    el.addEventListener(eventNames[i], handler);
  }
}

function removeEventListeners (el, eventNames, handler) {
  var i;
  for (i = 0; i < eventNames.length; i++) {
    el.removeEventListener(eventNames[i], handler);
  }
}

function getRawProperty (el, path) {
  var i;
  var split;
  var value;
  split = splitDot(path);
  value = el;
  for (i = 0; i < split.length; i++) { value = value[split[i]]; }
  return value;
}

function setRawProperty (el, path, value, type) {
  var i;
  var split;
  var propertyName;
  var targetValue;

  // Walk.
  split = splitDot(path);
  targetValue = el;
  for (i = 0; i < split.length - 1; i++) { targetValue = targetValue[split[i]]; }
  propertyName = split[split.length - 1];

  // Raw color.
  if (type === TYPE_COLOR) {
    if ('r' in targetValue[propertyName]) {
      targetValue[propertyName].r = value.r;
      targetValue[propertyName].g = value.g;
      targetValue[propertyName].b = value.b;
    } else {
      targetValue[propertyName].x = value.r;
      targetValue[propertyName].y = value.g;
      targetValue[propertyName].z = value.b;
    }
    return;
  }

  targetValue[propertyName] = value;
}

function splitDot (path) {
  if (path in splitCache) { return splitCache[path]; }
  splitCache[path] = path.split('.');
  return splitCache[path];
}

function isRawProperty (data) {
  return data.isRawProperty || data.property.startsWith(STRING_COMPONENTS) ||
         data.property.startsWith(STRING_OBJECT3D);
}
