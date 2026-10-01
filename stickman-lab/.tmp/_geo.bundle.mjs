var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../全新的游戏/node_modules/@dimforge/rapier3d/rapier_wasm3d_bg.js
var rapier_wasm3d_bg_exports = {};
__export(rapier_wasm3d_bg_exports, {
  RawBroadPhase: () => RawBroadPhase,
  RawCCDSolver: () => RawCCDSolver,
  RawCharacterCollision: () => RawCharacterCollision,
  RawColliderSet: () => RawColliderSet,
  RawColliderShapeCastHit: () => RawColliderShapeCastHit,
  RawContactForceEvent: () => RawContactForceEvent,
  RawContactManifold: () => RawContactManifold,
  RawContactPair: () => RawContactPair,
  RawDebugRenderPipeline: () => RawDebugRenderPipeline,
  RawDeserializedWorld: () => RawDeserializedWorld,
  RawDynamicRayCastVehicleController: () => RawDynamicRayCastVehicleController,
  RawEventQueue: () => RawEventQueue,
  RawFeatureType: () => RawFeatureType,
  RawGenericJoint: () => RawGenericJoint,
  RawImpulseJointSet: () => RawImpulseJointSet,
  RawIntegrationParameters: () => RawIntegrationParameters,
  RawIslandManager: () => RawIslandManager,
  RawJointAxis: () => RawJointAxis,
  RawJointType: () => RawJointType,
  RawKinematicCharacterController: () => RawKinematicCharacterController,
  RawMotorModel: () => RawMotorModel,
  RawMultibodyJointSet: () => RawMultibodyJointSet,
  RawNarrowPhase: () => RawNarrowPhase,
  RawPhysicsPipeline: () => RawPhysicsPipeline,
  RawPointColliderProjection: () => RawPointColliderProjection,
  RawPointProjection: () => RawPointProjection,
  RawQueryPipeline: () => RawQueryPipeline,
  RawRayColliderHit: () => RawRayColliderHit,
  RawRayColliderIntersection: () => RawRayColliderIntersection,
  RawRayIntersection: () => RawRayIntersection,
  RawRigidBodySet: () => RawRigidBodySet,
  RawRigidBodyType: () => RawRigidBodyType,
  RawRotation: () => RawRotation,
  RawSdpMatrix3: () => RawSdpMatrix3,
  RawSerializationPipeline: () => RawSerializationPipeline,
  RawShape: () => RawShape,
  RawShapeCastHit: () => RawShapeCastHit,
  RawShapeContact: () => RawShapeContact,
  RawShapeType: () => RawShapeType,
  RawVector: () => RawVector,
  __wbg_bind_4d857b598695205e: () => __wbg_bind_4d857b598695205e,
  __wbg_buffer_12d079cc21e14bdb: () => __wbg_buffer_12d079cc21e14bdb,
  __wbg_call_8e7cb608789c2528: () => __wbg_call_8e7cb608789c2528,
  __wbg_call_938992c832f74314: () => __wbg_call_938992c832f74314,
  __wbg_call_b3ca7c6051f9bec1: () => __wbg_call_b3ca7c6051f9bec1,
  __wbg_length_c20a40f15020d68a: () => __wbg_length_c20a40f15020d68a,
  __wbg_length_d25bbcbc3367f684: () => __wbg_length_d25bbcbc3367f684,
  __wbg_new_63b92bc8671ed464: () => __wbg_new_63b92bc8671ed464,
  __wbg_newwithbyteoffsetandlength_4a659d079a1650e0: () => __wbg_newwithbyteoffsetandlength_4a659d079a1650e0,
  __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb: () => __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb,
  __wbg_newwithlength_1e8b839a06de01c5: () => __wbg_newwithlength_1e8b839a06de01c5,
  __wbg_rawcontactforceevent_new: () => __wbg_rawcontactforceevent_new,
  __wbg_rawraycolliderintersection_new: () => __wbg_rawraycolliderintersection_new,
  __wbg_set_a47bac70306a19a7: () => __wbg_set_a47bac70306a19a7,
  __wbg_set_bd975934d1b1fddb: () => __wbg_set_bd975934d1b1fddb,
  __wbg_set_wasm: () => __wbg_set_wasm,
  __wbindgen_boolean_get: () => __wbindgen_boolean_get,
  __wbindgen_is_function: () => __wbindgen_is_function,
  __wbindgen_memory: () => __wbindgen_memory,
  __wbindgen_number_get: () => __wbindgen_number_get,
  __wbindgen_number_new: () => __wbindgen_number_new,
  __wbindgen_object_drop_ref: () => __wbindgen_object_drop_ref,
  __wbindgen_throw: () => __wbindgen_throw,
  version: () => version
});
var wasm;
function __wbg_set_wasm(val) {
  wasm = val;
}
var heap = new Array(128).fill(void 0);
heap.push(void 0, null, true, false);
var heap_next = heap.length;
function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
function getObject(idx) {
  return heap[idx];
}
function dropObject(idx) {
  if (idx < 132) return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
function isLikeNone(x) {
  return x === void 0 || x === null;
}
var cachedFloat64Memory0 = null;
function getFloat64Memory0() {
  if (cachedFloat64Memory0 === null || cachedFloat64Memory0.byteLength === 0) {
    cachedFloat64Memory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64Memory0;
}
var cachedInt32Memory0 = null;
function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}
var lTextDecoder = typeof TextDecoder === "undefined" ? (0, module.require)("util").TextDecoder : TextDecoder;
var cachedTextDecoder = new lTextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var cachedUint8Memory0 = null;
function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}
function version() {
  let deferred1_0;
  let deferred1_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.version(retptr);
    var r0 = getInt32Memory0()[retptr / 4 + 0];
    var r1 = getInt32Memory0()[retptr / 4 + 1];
    deferred1_0 = r0;
    deferred1_1 = r1;
    return getStringFromWasm0(r0, r1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
  return instance.ptr;
}
var cachedFloat32Memory0 = null;
function getFloat32Memory0() {
  if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
    cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32Memory0;
}
var stack_pointer = 128;
function addBorrowedObject(obj) {
  if (stack_pointer == 1) throw new Error("out of js stack");
  heap[--stack_pointer] = obj;
  return stack_pointer;
}
function getArrayF32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
var cachedUint32Memory0 = null;
function getUint32Memory0() {
  if (cachedUint32Memory0 === null || cachedUint32Memory0.byteLength === 0) {
    cachedUint32Memory0 = new Uint32Array(wasm.memory.buffer);
  }
  return cachedUint32Memory0;
}
function getArrayU32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
var WASM_VECTOR_LEN = 0;
function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getFloat32Memory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function passArray32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0;
  getUint32Memory0().set(arg, ptr / 4);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}
var RawFeatureType = Object.freeze({ Vertex: 0, "0": "Vertex", Edge: 1, "1": "Edge", Face: 2, "2": "Face", Unknown: 3, "3": "Unknown" });
var RawShapeType = Object.freeze({ Ball: 0, "0": "Ball", Cuboid: 1, "1": "Cuboid", Capsule: 2, "2": "Capsule", Segment: 3, "3": "Segment", Polyline: 4, "4": "Polyline", Triangle: 5, "5": "Triangle", TriMesh: 6, "6": "TriMesh", HeightField: 7, "7": "HeightField", Compound: 8, "8": "Compound", ConvexPolyhedron: 9, "9": "ConvexPolyhedron", Cylinder: 10, "10": "Cylinder", Cone: 11, "11": "Cone", RoundCuboid: 12, "12": "RoundCuboid", RoundTriangle: 13, "13": "RoundTriangle", RoundCylinder: 14, "14": "RoundCylinder", RoundCone: 15, "15": "RoundCone", RoundConvexPolyhedron: 16, "16": "RoundConvexPolyhedron", HalfSpace: 17, "17": "HalfSpace" });
var RawJointAxis = Object.freeze({ LinX: 0, "0": "LinX", LinY: 1, "1": "LinY", LinZ: 2, "2": "LinZ", AngX: 3, "3": "AngX", AngY: 4, "4": "AngY", AngZ: 5, "5": "AngZ" });
var RawRigidBodyType = Object.freeze({ Dynamic: 0, "0": "Dynamic", Fixed: 1, "1": "Fixed", KinematicPositionBased: 2, "2": "KinematicPositionBased", KinematicVelocityBased: 3, "3": "KinematicVelocityBased" });
var RawMotorModel = Object.freeze({ AccelerationBased: 0, "0": "AccelerationBased", ForceBased: 1, "1": "ForceBased" });
var RawJointType = Object.freeze({ Revolute: 0, "0": "Revolute", Fixed: 1, "1": "Fixed", Prismatic: 2, "2": "Prismatic", Rope: 3, "3": "Rope", Spring: 4, "4": "Spring", Spherical: 5, "5": "Spherical", Generic: 6, "6": "Generic" });
var RawBroadPhaseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawbroadphase_free(ptr >>> 0));
var RawBroadPhase = class _RawBroadPhase {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawBroadPhase.prototype);
    obj.__wbg_ptr = ptr;
    RawBroadPhaseFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawBroadPhaseFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawbroadphase_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawbroadphase_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
};
var RawCCDSolverFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawccdsolver_free(ptr >>> 0));
var RawCCDSolver = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawCCDSolverFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawccdsolver_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawccdsolver_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
};
var RawCharacterCollisionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcharactercollision_free(ptr >>> 0));
var RawCharacterCollision = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawCharacterCollisionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcharactercollision_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawcharactercollision_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {number}
  */
  handle() {
    const ret = wasm.rawcharactercollision_handle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  translationDeltaApplied() {
    const ret = wasm.rawcharactercollision_translationDeltaApplied(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  translationDeltaRemaining() {
    const ret = wasm.rawcharactercollision_translationDeltaRemaining(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {number}
  */
  toi() {
    const ret = wasm.rawcharactercollision_toi(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  worldWitness1() {
    const ret = wasm.rawcharactercollision_worldWitness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  worldWitness2() {
    const ret = wasm.rawcharactercollision_worldWitness2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  worldNormal1() {
    const ret = wasm.rawcharactercollision_worldNormal1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  worldNormal2() {
    const ret = wasm.rawcharactercollision_worldNormal2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
};
var RawColliderSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcolliderset_free(ptr >>> 0));
var RawColliderSet = class _RawColliderSet {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawColliderSet.prototype);
    obj.__wbg_ptr = ptr;
    RawColliderSetFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawColliderSetFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcolliderset_free(ptr);
  }
  /**
  * The world-space translation of this collider.
  * @param {number} handle
  * @returns {RawVector}
  */
  coTranslation(handle) {
    const ret = wasm.rawcolliderset_coTranslation(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The world-space orientation of this collider.
  * @param {number} handle
  * @returns {RawRotation}
  */
  coRotation(handle) {
    const ret = wasm.rawcolliderset_coRotation(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * Sets the translation of this collider.
  *
  * # Parameters
  * - `x`: the world-space position of the collider along the `x` axis.
  * - `y`: the world-space position of the collider along the `y` axis.
  * - `z`: the world-space position of the collider along the `z` axis.
  * - `wakeUp`: forces the collider to wake-up so it is properly affected by forces if it
  * wasn't moving before modifying its position.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  */
  coSetTranslation(handle, x, y, z) {
    wasm.rawcolliderset_coSetTranslation(this.__wbg_ptr, handle, x, y, z);
  }
  /**
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  */
  coSetTranslationWrtParent(handle, x, y, z) {
    wasm.rawcolliderset_coSetTranslationWrtParent(this.__wbg_ptr, handle, x, y, z);
  }
  /**
  * Sets the rotation quaternion of this collider.
  *
  * This does nothing if a zero quaternion is provided.
  *
  * # Parameters
  * - `x`: the first vector component of the quaternion.
  * - `y`: the second vector component of the quaternion.
  * - `z`: the third vector component of the quaternion.
  * - `w`: the scalar component of the quaternion.
  * - `wakeUp`: forces the collider to wake-up so it is properly affected by forces if it
  * wasn't moving before modifying its position.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {number} w
  */
  coSetRotation(handle, x, y, z, w) {
    wasm.rawcolliderset_coSetRotation(this.__wbg_ptr, handle, x, y, z, w);
  }
  /**
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {number} w
  */
  coSetRotationWrtParent(handle, x, y, z, w) {
    wasm.rawcolliderset_coSetRotationWrtParent(this.__wbg_ptr, handle, x, y, z, w);
  }
  /**
  * Is this collider a sensor?
  * @param {number} handle
  * @returns {boolean}
  */
  coIsSensor(handle) {
    const ret = wasm.rawcolliderset_coIsSensor(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * The type of the shape of this collider.
  * @param {number} handle
  * @returns {RawShapeType}
  */
  coShapeType(handle) {
    const ret = wasm.rawcolliderset_coShapeType(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * @param {number} handle
  * @returns {RawVector | undefined}
  */
  coHalfspaceNormal(handle) {
    const ret = wasm.rawcolliderset_coHalfspaceNormal(this.__wbg_ptr, handle);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * The half-extents of this collider if it is has a cuboid shape.
  * @param {number} handle
  * @returns {RawVector | undefined}
  */
  coHalfExtents(handle) {
    const ret = wasm.rawcolliderset_coHalfExtents(this.__wbg_ptr, handle);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * Set the half-extents of this collider if it has a cuboid shape.
  * @param {number} handle
  * @param {RawVector} newHalfExtents
  */
  coSetHalfExtents(handle, newHalfExtents) {
    _assertClass(newHalfExtents, RawVector);
    wasm.rawcolliderset_coSetHalfExtents(this.__wbg_ptr, handle, newHalfExtents.__wbg_ptr);
  }
  /**
  * The radius of this collider if it is a ball, capsule, cylinder, or cone shape.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coRadius(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coRadius(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Set the radius of this collider if it is a ball, capsule, cylinder, or cone shape.
  * @param {number} handle
  * @param {number} newRadius
  */
  coSetRadius(handle, newRadius) {
    wasm.rawcolliderset_coSetRadius(this.__wbg_ptr, handle, newRadius);
  }
  /**
  * The half height of this collider if it is a capsule, cylinder, or cone shape.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coHalfHeight(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coHalfHeight(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Set the half height of this collider if it is a capsule, cylinder, or cone shape.
  * @param {number} handle
  * @param {number} newHalfheight
  */
  coSetHalfHeight(handle, newHalfheight) {
    wasm.rawcolliderset_coSetHalfHeight(this.__wbg_ptr, handle, newHalfheight);
  }
  /**
  * The radius of the round edges of this collider.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coRoundRadius(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coRoundRadius(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Set the radius of the round edges of this collider.
  * @param {number} handle
  * @param {number} newBorderRadius
  */
  coSetRoundRadius(handle, newBorderRadius) {
    wasm.rawcolliderset_coSetRoundRadius(this.__wbg_ptr, handle, newBorderRadius);
  }
  /**
  * The vertices of this triangle mesh, polyline, convex polyhedron, segment, triangle or convex polyhedron, if it is one.
  * @param {number} handle
  * @returns {Float32Array | undefined}
  */
  coVertices(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coVertices(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      let v1;
      if (r0 !== 0) {
        v1 = getArrayF32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 4, 4);
      }
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * The indices of this triangle mesh, polyline, or convex polyhedron, if it is one.
  * @param {number} handle
  * @returns {Uint32Array | undefined}
  */
  coIndices(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coIndices(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      let v1;
      if (r0 !== 0) {
        v1 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 4, 4);
      }
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} handle
  * @returns {number | undefined}
  */
  coTriMeshFlags(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coTriMeshFlags(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} handle
  * @returns {number | undefined}
  */
  coHeightFieldFlags(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coHeightFieldFlags(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * The height of this heightfield if it is one.
  * @param {number} handle
  * @returns {Float32Array | undefined}
  */
  coHeightfieldHeights(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coHeightfieldHeights(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      let v1;
      if (r0 !== 0) {
        v1 = getArrayF32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 4, 4);
      }
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * The scaling factor applied of this heightfield if it is one.
  * @param {number} handle
  * @returns {RawVector | undefined}
  */
  coHeightfieldScale(handle) {
    const ret = wasm.rawcolliderset_coHeightfieldScale(this.__wbg_ptr, handle);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * The number of rows on this heightfield's height matrix, if it is one.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coHeightfieldNRows(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coHeightfieldNRows(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * The number of columns on this heightfield's height matrix, if it is one.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coHeightfieldNCols(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coHeightfieldNCols(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * The unique integer identifier of the collider this collider is attached to.
  * @param {number} handle
  * @returns {number | undefined}
  */
  coParent(handle) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawcolliderset_coParent(retptr, this.__wbg_ptr, handle);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r2 = getFloat64Memory0()[retptr / 8 + 1];
      return r0 === 0 ? void 0 : r2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} handle
  * @param {boolean} enabled
  */
  coSetEnabled(handle, enabled) {
    wasm.rawcolliderset_coSetEnabled(this.__wbg_ptr, handle, enabled);
  }
  /**
  * @param {number} handle
  * @returns {boolean}
  */
  coIsEnabled(handle) {
    const ret = wasm.rawcolliderset_coIsEnabled(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @param {number} contact_skin
  */
  coSetContactSkin(handle, contact_skin) {
    wasm.rawcolliderset_coSetContactSkin(this.__wbg_ptr, handle, contact_skin);
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  coContactSkin(handle) {
    const ret = wasm.rawcolliderset_coContactSkin(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The friction coefficient of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coFriction(handle) {
    const ret = wasm.rawcolliderset_coFriction(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The restitution coefficient of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coRestitution(handle) {
    const ret = wasm.rawcolliderset_coRestitution(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The density of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coDensity(handle) {
    const ret = wasm.rawcolliderset_coDensity(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The mass of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coMass(handle) {
    const ret = wasm.rawcolliderset_coMass(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The volume of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coVolume(handle) {
    const ret = wasm.rawcolliderset_coVolume(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The collision groups of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coCollisionGroups(handle) {
    const ret = wasm.rawcolliderset_coCollisionGroups(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * The solver groups of this collider.
  * @param {number} handle
  * @returns {number}
  */
  coSolverGroups(handle) {
    const ret = wasm.rawcolliderset_coSolverGroups(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * The physics hooks enabled for this collider.
  * @param {number} handle
  * @returns {number}
  */
  coActiveHooks(handle) {
    const ret = wasm.rawcolliderset_coActiveHooks(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * The collision types enabled for this collider.
  * @param {number} handle
  * @returns {number}
  */
  coActiveCollisionTypes(handle) {
    const ret = wasm.rawcolliderset_coActiveCollisionTypes(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The events enabled for this collider.
  * @param {number} handle
  * @returns {number}
  */
  coActiveEvents(handle) {
    const ret = wasm.rawcolliderset_coActiveEvents(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * The total force magnitude beyond which a contact force event can be emitted.
  * @param {number} handle
  * @returns {number}
  */
  coContactForceEventThreshold(handle) {
    const ret = wasm.rawcolliderset_coContactForceEventThreshold(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {RawVector} point
  * @returns {boolean}
  */
  coContainsPoint(handle, point) {
    _assertClass(point, RawVector);
    const ret = wasm.rawcolliderset_coContainsPoint(this.__wbg_ptr, handle, point.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @param {RawVector} colliderVel
  * @param {RawShape} shape2
  * @param {RawVector} shape2Pos
  * @param {RawRotation} shape2Rot
  * @param {RawVector} shape2Vel
  * @param {number} target_distance
  * @param {number} maxToi
  * @param {boolean} stop_at_penetration
  * @returns {RawShapeCastHit | undefined}
  */
  coCastShape(handle, colliderVel, shape2, shape2Pos, shape2Rot, shape2Vel, target_distance, maxToi, stop_at_penetration) {
    _assertClass(colliderVel, RawVector);
    _assertClass(shape2, RawShape);
    _assertClass(shape2Pos, RawVector);
    _assertClass(shape2Rot, RawRotation);
    _assertClass(shape2Vel, RawVector);
    const ret = wasm.rawcolliderset_coCastShape(this.__wbg_ptr, handle, colliderVel.__wbg_ptr, shape2.__wbg_ptr, shape2Pos.__wbg_ptr, shape2Rot.__wbg_ptr, shape2Vel.__wbg_ptr, target_distance, maxToi, stop_at_penetration);
    return ret === 0 ? void 0 : RawShapeCastHit.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {RawVector} collider1Vel
  * @param {number} collider2handle
  * @param {RawVector} collider2Vel
  * @param {number} target_distance
  * @param {number} max_toi
  * @param {boolean} stop_at_penetration
  * @returns {RawColliderShapeCastHit | undefined}
  */
  coCastCollider(handle, collider1Vel, collider2handle, collider2Vel, target_distance, max_toi, stop_at_penetration) {
    _assertClass(collider1Vel, RawVector);
    _assertClass(collider2Vel, RawVector);
    const ret = wasm.rawcolliderset_coCastCollider(this.__wbg_ptr, handle, collider1Vel.__wbg_ptr, collider2handle, collider2Vel.__wbg_ptr, target_distance, max_toi, stop_at_penetration);
    return ret === 0 ? void 0 : RawColliderShapeCastHit.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {RawShape} shape2
  * @param {RawVector} shapePos2
  * @param {RawRotation} shapeRot2
  * @returns {boolean}
  */
  coIntersectsShape(handle, shape2, shapePos2, shapeRot2) {
    _assertClass(shape2, RawShape);
    _assertClass(shapePos2, RawVector);
    _assertClass(shapeRot2, RawRotation);
    const ret = wasm.rawcolliderset_coIntersectsShape(this.__wbg_ptr, handle, shape2.__wbg_ptr, shapePos2.__wbg_ptr, shapeRot2.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @param {RawShape} shape2
  * @param {RawVector} shapePos2
  * @param {RawRotation} shapeRot2
  * @param {number} prediction
  * @returns {RawShapeContact | undefined}
  */
  coContactShape(handle, shape2, shapePos2, shapeRot2, prediction) {
    _assertClass(shape2, RawShape);
    _assertClass(shapePos2, RawVector);
    _assertClass(shapeRot2, RawRotation);
    const ret = wasm.rawcolliderset_coContactShape(this.__wbg_ptr, handle, shape2.__wbg_ptr, shapePos2.__wbg_ptr, shapeRot2.__wbg_ptr, prediction);
    return ret === 0 ? void 0 : RawShapeContact.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {number} collider2handle
  * @param {number} prediction
  * @returns {RawShapeContact | undefined}
  */
  coContactCollider(handle, collider2handle, prediction) {
    const ret = wasm.rawcolliderset_coContactCollider(this.__wbg_ptr, handle, collider2handle, prediction);
    return ret === 0 ? void 0 : RawShapeContact.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {RawVector} point
  * @param {boolean} solid
  * @returns {RawPointProjection}
  */
  coProjectPoint(handle, point, solid) {
    _assertClass(point, RawVector);
    const ret = wasm.rawcolliderset_coProjectPoint(this.__wbg_ptr, handle, point.__wbg_ptr, solid);
    return RawPointProjection.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @returns {boolean}
  */
  coIntersectsRay(handle, rayOrig, rayDir, maxToi) {
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawcolliderset_coIntersectsRay(this.__wbg_ptr, handle, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @returns {number}
  */
  coCastRay(handle, rayOrig, rayDir, maxToi, solid) {
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawcolliderset_coCastRay(this.__wbg_ptr, handle, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @returns {RawRayIntersection | undefined}
  */
  coCastRayAndGetNormal(handle, rayOrig, rayDir, maxToi, solid) {
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawcolliderset_coCastRayAndGetNormal(this.__wbg_ptr, handle, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid);
    return ret === 0 ? void 0 : RawRayIntersection.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {boolean} is_sensor
  */
  coSetSensor(handle, is_sensor) {
    wasm.rawcolliderset_coSetSensor(this.__wbg_ptr, handle, is_sensor);
  }
  /**
  * @param {number} handle
  * @param {number} restitution
  */
  coSetRestitution(handle, restitution) {
    wasm.rawcolliderset_coSetRestitution(this.__wbg_ptr, handle, restitution);
  }
  /**
  * @param {number} handle
  * @param {number} friction
  */
  coSetFriction(handle, friction) {
    wasm.rawcolliderset_coSetFriction(this.__wbg_ptr, handle, friction);
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  coFrictionCombineRule(handle) {
    const ret = wasm.rawcolliderset_coFrictionCombineRule(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * @param {number} handle
  * @param {number} rule
  */
  coSetFrictionCombineRule(handle, rule) {
    wasm.rawcolliderset_coSetFrictionCombineRule(this.__wbg_ptr, handle, rule);
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  coRestitutionCombineRule(handle) {
    const ret = wasm.rawcolliderset_coRestitutionCombineRule(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * @param {number} handle
  * @param {number} rule
  */
  coSetRestitutionCombineRule(handle, rule) {
    wasm.rawcolliderset_coSetRestitutionCombineRule(this.__wbg_ptr, handle, rule);
  }
  /**
  * @param {number} handle
  * @param {number} groups
  */
  coSetCollisionGroups(handle, groups) {
    wasm.rawcolliderset_coSetCollisionGroups(this.__wbg_ptr, handle, groups);
  }
  /**
  * @param {number} handle
  * @param {number} groups
  */
  coSetSolverGroups(handle, groups) {
    wasm.rawcolliderset_coSetSolverGroups(this.__wbg_ptr, handle, groups);
  }
  /**
  * @param {number} handle
  * @param {number} hooks
  */
  coSetActiveHooks(handle, hooks) {
    wasm.rawcolliderset_coSetActiveHooks(this.__wbg_ptr, handle, hooks);
  }
  /**
  * @param {number} handle
  * @param {number} events
  */
  coSetActiveEvents(handle, events) {
    wasm.rawcolliderset_coSetActiveEvents(this.__wbg_ptr, handle, events);
  }
  /**
  * @param {number} handle
  * @param {number} types
  */
  coSetActiveCollisionTypes(handle, types) {
    wasm.rawcolliderset_coSetActiveCollisionTypes(this.__wbg_ptr, handle, types);
  }
  /**
  * @param {number} handle
  * @param {RawShape} shape
  */
  coSetShape(handle, shape) {
    _assertClass(shape, RawShape);
    wasm.rawcolliderset_coSetShape(this.__wbg_ptr, handle, shape.__wbg_ptr);
  }
  /**
  * @param {number} handle
  * @param {number} threshold
  */
  coSetContactForceEventThreshold(handle, threshold) {
    wasm.rawcolliderset_coSetContactForceEventThreshold(this.__wbg_ptr, handle, threshold);
  }
  /**
  * @param {number} handle
  * @param {number} density
  */
  coSetDensity(handle, density) {
    wasm.rawcolliderset_coSetDensity(this.__wbg_ptr, handle, density);
  }
  /**
  * @param {number} handle
  * @param {number} mass
  */
  coSetMass(handle, mass) {
    wasm.rawcolliderset_coSetMass(this.__wbg_ptr, handle, mass);
  }
  /**
  * @param {number} handle
  * @param {number} mass
  * @param {RawVector} centerOfMass
  * @param {RawVector} principalAngularInertia
  * @param {RawRotation} angularInertiaFrame
  */
  coSetMassProperties(handle, mass, centerOfMass, principalAngularInertia, angularInertiaFrame) {
    _assertClass(centerOfMass, RawVector);
    _assertClass(principalAngularInertia, RawVector);
    _assertClass(angularInertiaFrame, RawRotation);
    wasm.rawcolliderset_coSetMassProperties(this.__wbg_ptr, handle, mass, centerOfMass.__wbg_ptr, principalAngularInertia.__wbg_ptr, angularInertiaFrame.__wbg_ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawcolliderset_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {number}
  */
  len() {
    const ret = wasm.rawcolliderset_len(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} handle
  * @returns {boolean}
  */
  contains(handle) {
    const ret = wasm.rawcolliderset_contains(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * @param {boolean} enabled
  * @param {RawShape} shape
  * @param {RawVector} translation
  * @param {RawRotation} rotation
  * @param {number} massPropsMode
  * @param {number} mass
  * @param {RawVector} centerOfMass
  * @param {RawVector} principalAngularInertia
  * @param {RawRotation} angularInertiaFrame
  * @param {number} density
  * @param {number} friction
  * @param {number} restitution
  * @param {number} frictionCombineRule
  * @param {number} restitutionCombineRule
  * @param {boolean} isSensor
  * @param {number} collisionGroups
  * @param {number} solverGroups
  * @param {number} activeCollisionTypes
  * @param {number} activeHooks
  * @param {number} activeEvents
  * @param {number} contactForceEventThreshold
  * @param {number} contactSkin
  * @param {boolean} hasParent
  * @param {number} parent
  * @param {RawRigidBodySet} bodies
  * @returns {number | undefined}
  */
  createCollider(enabled, shape, translation, rotation, massPropsMode, mass, centerOfMass, principalAngularInertia, angularInertiaFrame, density, friction, restitution, frictionCombineRule, restitutionCombineRule, isSensor, collisionGroups, solverGroups, activeCollisionTypes, activeHooks, activeEvents, contactForceEventThreshold, contactSkin, hasParent, parent, bodies) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      _assertClass(shape, RawShape);
      _assertClass(translation, RawVector);
      _assertClass(rotation, RawRotation);
      _assertClass(centerOfMass, RawVector);
      _assertClass(principalAngularInertia, RawVector);
      _assertClass(angularInertiaFrame, RawRotation);
      _assertClass(bodies, RawRigidBodySet);
      wasm.rawcolliderset_createCollider(retptr, this.__wbg_ptr, enabled, shape.__wbg_ptr, translation.__wbg_ptr, rotation.__wbg_ptr, massPropsMode, mass, centerOfMass.__wbg_ptr, principalAngularInertia.__wbg_ptr, angularInertiaFrame.__wbg_ptr, density, friction, restitution, frictionCombineRule, restitutionCombineRule, isSensor, collisionGroups, solverGroups, activeCollisionTypes, activeHooks, activeEvents, contactForceEventThreshold, contactSkin, hasParent, parent, bodies.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r2 = getFloat64Memory0()[retptr / 8 + 1];
      return r0 === 0 ? void 0 : r2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * Removes a collider from this set and wake-up the rigid-body it is attached to.
  * @param {number} handle
  * @param {RawIslandManager} islands
  * @param {RawRigidBodySet} bodies
  * @param {boolean} wakeUp
  */
  remove(handle, islands, bodies, wakeUp) {
    _assertClass(islands, RawIslandManager);
    _assertClass(bodies, RawRigidBodySet);
    wasm.rawcolliderset_remove(this.__wbg_ptr, handle, islands.__wbg_ptr, bodies.__wbg_ptr, wakeUp);
  }
  /**
  * Checks if a collider with the given integer handle exists.
  * @param {number} handle
  * @returns {boolean}
  */
  isHandleValid(handle) {
    const ret = wasm.rawcolliderset_contains(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Applies the given JavaScript function to the integer handle of each collider managed by this collider set.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each collider managed by this collider set. Called as `f(handle)`.
  * @param {Function} f
  */
  forEachColliderHandle(f) {
    try {
      wasm.rawcolliderset_forEachColliderHandle(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
};
var RawColliderShapeCastHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcollidershapecasthit_free(ptr >>> 0));
var RawColliderShapeCastHit = class _RawColliderShapeCastHit {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawColliderShapeCastHit.prototype);
    obj.__wbg_ptr = ptr;
    RawColliderShapeCastHitFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawColliderShapeCastHitFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcollidershapecasthit_free(ptr);
  }
  /**
  * @returns {number}
  */
  colliderHandle() {
    const ret = wasm.rawcharactercollision_handle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  time_of_impact() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  witness1() {
    const ret = wasm.rawcollidershapecasthit_witness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  witness2() {
    const ret = wasm.rawcollidershapecasthit_witness2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal1() {
    const ret = wasm.rawcharactercollision_translationDeltaApplied(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal2() {
    const ret = wasm.rawcharactercollision_translationDeltaRemaining(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
};
var RawContactForceEventFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactforceevent_free(ptr >>> 0));
var RawContactForceEvent = class _RawContactForceEvent {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawContactForceEvent.prototype);
    obj.__wbg_ptr = ptr;
    RawContactForceEventFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawContactForceEventFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcontactforceevent_free(ptr);
  }
  /**
  * The first collider involved in the contact.
  * @returns {number}
  */
  collider1() {
    const ret = wasm.rawcharactercollision_handle(this.__wbg_ptr);
    return ret;
  }
  /**
  * The second collider involved in the contact.
  * @returns {number}
  */
  collider2() {
    const ret = wasm.rawcontactforceevent_collider2(this.__wbg_ptr);
    return ret;
  }
  /**
  * The sum of all the forces between the two colliders.
  * @returns {RawVector}
  */
  total_force() {
    const ret = wasm.rawcontactforceevent_total_force(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * The sum of the magnitudes of each force between the two colliders.
  *
  * Note that this is **not** the same as the magnitude of `self.total_force`.
  * Here we are summing the magnitude of all the forces, instead of taking
  * the magnitude of their sum.
  * @returns {number}
  */
  total_force_magnitude() {
    const ret = wasm.rawcontactforceevent_total_force_magnitude(this.__wbg_ptr);
    return ret;
  }
  /**
  * The world-space (unit) direction of the force with strongest magnitude.
  * @returns {RawVector}
  */
  max_force_direction() {
    const ret = wasm.rawcontactforceevent_max_force_direction(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * The magnitude of the largest force at a contact point of this contact pair.
  * @returns {number}
  */
  max_force_magnitude() {
    const ret = wasm.rawcontactforceevent_max_force_magnitude(this.__wbg_ptr);
    return ret;
  }
};
var RawContactManifoldFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactmanifold_free(ptr >>> 0));
var RawContactManifold = class _RawContactManifold {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawContactManifold.prototype);
    obj.__wbg_ptr = ptr;
    RawContactManifoldFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawContactManifoldFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcontactmanifold_free(ptr);
  }
  /**
  * @returns {RawVector}
  */
  normal() {
    const ret = wasm.rawcontactmanifold_normal(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  local_n1() {
    const ret = wasm.rawcontactmanifold_local_n1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  local_n2() {
    const ret = wasm.rawcontactmanifold_local_n2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {number}
  */
  subshape1() {
    const ret = wasm.rawcontactmanifold_subshape1(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  subshape2() {
    const ret = wasm.rawcontactmanifold_subshape2(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  num_contacts() {
    const ret = wasm.rawcontactmanifold_num_contacts(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  contact_local_p1(i) {
    const ret = wasm.rawcontactmanifold_contact_local_p1(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  contact_local_p2(i) {
    const ret = wasm.rawcontactmanifold_contact_local_p2(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_dist(i) {
    const ret = wasm.rawcontactmanifold_contact_dist(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_fid1(i) {
    const ret = wasm.rawcontactmanifold_contact_fid1(this.__wbg_ptr, i);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_fid2(i) {
    const ret = wasm.rawcontactmanifold_contact_fid2(this.__wbg_ptr, i);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_impulse(i) {
    const ret = wasm.rawcontactmanifold_contact_impulse(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_tangent_impulse_x(i) {
    const ret = wasm.rawcontactmanifold_contact_tangent_impulse_x(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  contact_tangent_impulse_y(i) {
    const ret = wasm.rawcontactmanifold_contact_tangent_impulse_y(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @returns {number}
  */
  num_solver_contacts() {
    const ret = wasm.rawcontactmanifold_num_solver_contacts(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  solver_contact_point(i) {
    const ret = wasm.rawcontactmanifold_solver_contact_point(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  solver_contact_dist(i) {
    const ret = wasm.rawcontactmanifold_solver_contact_dist(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  solver_contact_friction(i) {
    const ret = wasm.rawcontactmanifold_solver_contact_friction(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {number}
  */
  solver_contact_restitution(i) {
    const ret = wasm.rawcontactmanifold_solver_contact_restitution(this.__wbg_ptr, i);
    return ret;
  }
  /**
  * @param {number} i
  * @returns {RawVector}
  */
  solver_contact_tangent_velocity(i) {
    const ret = wasm.rawcontactmanifold_solver_contact_tangent_velocity(this.__wbg_ptr, i);
    return RawVector.__wrap(ret);
  }
};
var RawContactPairFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactpair_free(ptr >>> 0));
var RawContactPair = class _RawContactPair {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawContactPair.prototype);
    obj.__wbg_ptr = ptr;
    RawContactPairFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawContactPairFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawcontactpair_free(ptr);
  }
  /**
  * @returns {number}
  */
  collider1() {
    const ret = wasm.rawcontactpair_collider1(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  collider2() {
    const ret = wasm.rawcontactpair_collider2(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  numContactManifolds() {
    const ret = wasm.rawcontactpair_numContactManifolds(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @returns {RawContactManifold | undefined}
  */
  contactManifold(i) {
    const ret = wasm.rawcontactpair_contactManifold(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawContactManifold.__wrap(ret);
  }
};
var RawDebugRenderPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdebugrenderpipeline_free(ptr >>> 0));
var RawDebugRenderPipeline = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawDebugRenderPipelineFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawdebugrenderpipeline_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawdebugrenderpipeline_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {Float32Array}
  */
  vertices() {
    const ret = wasm.rawdebugrenderpipeline_vertices(this.__wbg_ptr);
    return takeObject(ret);
  }
  /**
  * @returns {Float32Array}
  */
  colors() {
    const ret = wasm.rawdebugrenderpipeline_colors(this.__wbg_ptr);
    return takeObject(ret);
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawImpulseJointSet} impulse_joints
  * @param {RawMultibodyJointSet} multibody_joints
  * @param {RawNarrowPhase} narrow_phase
  */
  render(bodies, colliders, impulse_joints, multibody_joints, narrow_phase) {
    _assertClass(bodies, RawRigidBodySet);
    _assertClass(colliders, RawColliderSet);
    _assertClass(impulse_joints, RawImpulseJointSet);
    _assertClass(multibody_joints, RawMultibodyJointSet);
    _assertClass(narrow_phase, RawNarrowPhase);
    wasm.rawdebugrenderpipeline_render(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, impulse_joints.__wbg_ptr, multibody_joints.__wbg_ptr, narrow_phase.__wbg_ptr);
  }
};
var RawDeserializedWorldFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdeserializedworld_free(ptr >>> 0));
var RawDeserializedWorld = class _RawDeserializedWorld {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawDeserializedWorld.prototype);
    obj.__wbg_ptr = ptr;
    RawDeserializedWorldFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawDeserializedWorldFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawdeserializedworld_free(ptr);
  }
  /**
  * @returns {RawVector | undefined}
  */
  takeGravity() {
    const ret = wasm.rawdeserializedworld_takeGravity(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @returns {RawIntegrationParameters | undefined}
  */
  takeIntegrationParameters() {
    const ret = wasm.rawdeserializedworld_takeIntegrationParameters(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawIntegrationParameters.__wrap(ret);
  }
  /**
  * @returns {RawIslandManager | undefined}
  */
  takeIslandManager() {
    const ret = wasm.rawdeserializedworld_takeIslandManager(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawIslandManager.__wrap(ret);
  }
  /**
  * @returns {RawBroadPhase | undefined}
  */
  takeBroadPhase() {
    const ret = wasm.rawdeserializedworld_takeBroadPhase(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawBroadPhase.__wrap(ret);
  }
  /**
  * @returns {RawNarrowPhase | undefined}
  */
  takeNarrowPhase() {
    const ret = wasm.rawdeserializedworld_takeNarrowPhase(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawNarrowPhase.__wrap(ret);
  }
  /**
  * @returns {RawRigidBodySet | undefined}
  */
  takeBodies() {
    const ret = wasm.rawdeserializedworld_takeBodies(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawRigidBodySet.__wrap(ret);
  }
  /**
  * @returns {RawColliderSet | undefined}
  */
  takeColliders() {
    const ret = wasm.rawdeserializedworld_takeColliders(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawColliderSet.__wrap(ret);
  }
  /**
  * @returns {RawImpulseJointSet | undefined}
  */
  takeImpulseJoints() {
    const ret = wasm.rawdeserializedworld_takeImpulseJoints(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawImpulseJointSet.__wrap(ret);
  }
  /**
  * @returns {RawMultibodyJointSet | undefined}
  */
  takeMultibodyJoints() {
    const ret = wasm.rawdeserializedworld_takeMultibodyJoints(this.__wbg_ptr);
    return ret === 0 ? void 0 : RawMultibodyJointSet.__wrap(ret);
  }
};
var RawDynamicRayCastVehicleControllerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdynamicraycastvehiclecontroller_free(ptr >>> 0));
var RawDynamicRayCastVehicleController = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawDynamicRayCastVehicleControllerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawdynamicraycastvehiclecontroller_free(ptr);
  }
  /**
  * @param {number} chassis
  */
  constructor(chassis) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_new(chassis);
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {number}
  */
  current_vehicle_speed() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_current_vehicle_speed(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  chassis() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_chassis(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  index_up_axis() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_index_up_axis(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} axis
  */
  set_index_up_axis(axis) {
    wasm.rawdynamicraycastvehiclecontroller_set_index_up_axis(this.__wbg_ptr, axis);
  }
  /**
  * @returns {number}
  */
  index_forward_axis() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_index_forward_axis(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} axis
  */
  set_index_forward_axis(axis) {
    wasm.rawdynamicraycastvehiclecontroller_set_index_forward_axis(this.__wbg_ptr, axis);
  }
  /**
  * @param {RawVector} chassis_connection_cs
  * @param {RawVector} direction_cs
  * @param {RawVector} axle_cs
  * @param {number} suspension_rest_length
  * @param {number} radius
  */
  add_wheel(chassis_connection_cs, direction_cs, axle_cs, suspension_rest_length, radius) {
    _assertClass(chassis_connection_cs, RawVector);
    _assertClass(direction_cs, RawVector);
    _assertClass(axle_cs, RawVector);
    wasm.rawdynamicraycastvehiclecontroller_add_wheel(this.__wbg_ptr, chassis_connection_cs.__wbg_ptr, direction_cs.__wbg_ptr, axle_cs.__wbg_ptr, suspension_rest_length, radius);
  }
  /**
  * @returns {number}
  */
  num_wheels() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_num_wheels(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} dt
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawQueryPipeline} queries
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {Function} filter_predicate
  */
  update_vehicle(dt, bodies, colliders, queries, filter_flags, filter_groups, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(queries, RawQueryPipeline);
      wasm.rawdynamicraycastvehiclecontroller_update_vehicle(this.__wbg_ptr, dt, bodies.__wbg_ptr, colliders.__wbg_ptr, queries.__wbg_ptr, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, addBorrowedObject(filter_predicate));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_chassis_connection_point_cs(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_chassis_connection_point_cs(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @param {RawVector} value
  */
  set_wheel_chassis_connection_point_cs(i, value) {
    _assertClass(value, RawVector);
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_chassis_connection_point_cs(this.__wbg_ptr, i, value.__wbg_ptr);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_rest_length(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_rest_length(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_suspension_rest_length(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_suspension_rest_length(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_max_suspension_travel(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_max_suspension_travel(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_max_suspension_travel(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_max_suspension_travel(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_radius(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_radius(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_radius(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_radius(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_stiffness(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_stiffness(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_suspension_stiffness(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_suspension_stiffness(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_compression(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_compression(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_suspension_compression(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_suspension_compression(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_relaxation(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_relaxation(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_suspension_relaxation(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_suspension_relaxation(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_max_suspension_force(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_max_suspension_force(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_max_suspension_force(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_max_suspension_force(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_brake(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_brake(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_brake(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_brake(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_steering(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_steering(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_steering(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_steering(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_engine_force(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_engine_force(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_engine_force(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_engine_force(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_direction_cs(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_direction_cs(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @param {RawVector} value
  */
  set_wheel_direction_cs(i, value) {
    _assertClass(value, RawVector);
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_direction_cs(this.__wbg_ptr, i, value.__wbg_ptr);
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_axle_cs(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_axle_cs(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @param {RawVector} value
  */
  set_wheel_axle_cs(i, value) {
    _assertClass(value, RawVector);
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_axle_cs(this.__wbg_ptr, i, value.__wbg_ptr);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_friction_slip(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_friction_slip(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} value
  */
  set_wheel_friction_slip(i, value) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_friction_slip(this.__wbg_ptr, i, value);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_side_friction_stiffness(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_side_friction_stiffness(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @param {number} stiffness
  */
  set_wheel_side_friction_stiffness(i, stiffness) {
    wasm.rawdynamicraycastvehiclecontroller_set_wheel_side_friction_stiffness(this.__wbg_ptr, i, stiffness);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_rotation(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_rotation(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_forward_impulse(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_forward_impulse(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_side_impulse(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_side_impulse(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_force(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_force(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_contact_normal_ws(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_contact_normal_ws(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_contact_point_ws(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_contact_point_ws(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_suspension_length(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_suspension_length(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} i
  * @returns {RawVector | undefined}
  */
  wheel_hard_point_ws(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_hard_point_ws(this.__wbg_ptr, i);
    return ret === 0 ? void 0 : RawVector.__wrap(ret);
  }
  /**
  * @param {number} i
  * @returns {boolean}
  */
  wheel_is_in_contact(i) {
    const ret = wasm.rawdynamicraycastvehiclecontroller_wheel_is_in_contact(this.__wbg_ptr, i);
    return ret !== 0;
  }
  /**
  * @param {number} i
  * @returns {number | undefined}
  */
  wheel_ground_object(i) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawdynamicraycastvehiclecontroller_wheel_ground_object(retptr, this.__wbg_ptr, i);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r2 = getFloat64Memory0()[retptr / 8 + 1];
      return r0 === 0 ? void 0 : r2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
var RawEventQueueFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_raweventqueue_free(ptr >>> 0));
var RawEventQueue = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawEventQueueFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_raweventqueue_free(ptr);
  }
  /**
  * Creates a new event collector.
  *
  * # Parameters
  * - `autoDrain`: setting this to `true` is strongly recommended. If true, the collector will
  * be automatically drained before each `world.step(collector)`. If false, the collector will
  * keep all events in memory unless it is manually drained/cleared; this may lead to unbounded use of
  * RAM if no drain is performed.
  * @param {boolean} autoDrain
  */
  constructor(autoDrain) {
    const ret = wasm.raweventqueue_new(autoDrain);
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * Applies the given javascript closure on each collision event of this collector, then clear
  * the internal collision event buffer.
  *
  * # Parameters
  * - `f(handle1, handle2, started)`:  JavaScript closure applied to each collision event. The
  * closure should take three arguments: two integers representing the handles of the colliders
  * involved in the collision, and a boolean indicating if the collision started (true) or stopped
  * (false).
  * @param {Function} f
  */
  drainCollisionEvents(f) {
    try {
      wasm.raweventqueue_drainCollisionEvents(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {Function} f
  */
  drainContactForceEvents(f) {
    try {
      wasm.raweventqueue_drainContactForceEvents(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * Removes all events contained by this collector.
  */
  clear() {
    wasm.raweventqueue_clear(this.__wbg_ptr);
  }
};
var RawGenericJointFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawgenericjoint_free(ptr >>> 0));
var RawGenericJoint = class _RawGenericJoint {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawGenericJoint.prototype);
    obj.__wbg_ptr = ptr;
    RawGenericJointFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawGenericJointFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawgenericjoint_free(ptr);
  }
  /**
  * Creates a new joint descriptor that builds generic joints.
  *
  * Generic joints allow arbitrary axes of freedom to be selected
  * for the joint from the available 6 degrees of freedom.
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @param {RawVector} axis
  * @param {number} lockedAxes
  * @returns {RawGenericJoint | undefined}
  */
  static generic(anchor1, anchor2, axis, lockedAxes) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    _assertClass(axis, RawVector);
    const ret = wasm.rawgenericjoint_generic(anchor1.__wbg_ptr, anchor2.__wbg_ptr, axis.__wbg_ptr, lockedAxes);
    return ret === 0 ? void 0 : _RawGenericJoint.__wrap(ret);
  }
  /**
  * @param {number} rest_length
  * @param {number} stiffness
  * @param {number} damping
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @returns {RawGenericJoint}
  */
  static spring(rest_length, stiffness, damping, anchor1, anchor2) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    const ret = wasm.rawgenericjoint_spring(rest_length, stiffness, damping, anchor1.__wbg_ptr, anchor2.__wbg_ptr);
    return _RawGenericJoint.__wrap(ret);
  }
  /**
  * @param {number} length
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @returns {RawGenericJoint}
  */
  static rope(length, anchor1, anchor2) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    const ret = wasm.rawgenericjoint_rope(length, anchor1.__wbg_ptr, anchor2.__wbg_ptr);
    return _RawGenericJoint.__wrap(ret);
  }
  /**
  * Create a new joint descriptor that builds spherical joints.
  *
  * A spherical joints allows three relative rotational degrees of freedom
  * by preventing any relative translation between the anchors of the
  * two attached rigid-bodies.
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @returns {RawGenericJoint}
  */
  static spherical(anchor1, anchor2) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    const ret = wasm.rawgenericjoint_spherical(anchor1.__wbg_ptr, anchor2.__wbg_ptr);
    return _RawGenericJoint.__wrap(ret);
  }
  /**
  * Creates a new joint descriptor that builds a Prismatic joint.
  *
  * A prismatic joint removes all the degrees of freedom between the
  * affected bodies, except for the translation along one axis.
  *
  * Returns `None` if any of the provided axes cannot be normalized.
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @param {RawVector} axis
  * @param {boolean} limitsEnabled
  * @param {number} limitsMin
  * @param {number} limitsMax
  * @returns {RawGenericJoint | undefined}
  */
  static prismatic(anchor1, anchor2, axis, limitsEnabled, limitsMin, limitsMax) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    _assertClass(axis, RawVector);
    const ret = wasm.rawgenericjoint_prismatic(anchor1.__wbg_ptr, anchor2.__wbg_ptr, axis.__wbg_ptr, limitsEnabled, limitsMin, limitsMax);
    return ret === 0 ? void 0 : _RawGenericJoint.__wrap(ret);
  }
  /**
  * Creates a new joint descriptor that builds a Fixed joint.
  *
  * A fixed joint removes all the degrees of freedom between the affected bodies.
  * @param {RawVector} anchor1
  * @param {RawRotation} axes1
  * @param {RawVector} anchor2
  * @param {RawRotation} axes2
  * @returns {RawGenericJoint}
  */
  static fixed(anchor1, axes1, anchor2, axes2) {
    _assertClass(anchor1, RawVector);
    _assertClass(axes1, RawRotation);
    _assertClass(anchor2, RawVector);
    _assertClass(axes2, RawRotation);
    const ret = wasm.rawgenericjoint_fixed(anchor1.__wbg_ptr, axes1.__wbg_ptr, anchor2.__wbg_ptr, axes2.__wbg_ptr);
    return _RawGenericJoint.__wrap(ret);
  }
  /**
  * Create a new joint descriptor that builds Revolute joints.
  *
  * A revolute joint removes all degrees of freedom between the affected
  * bodies except for the rotation along one axis.
  * @param {RawVector} anchor1
  * @param {RawVector} anchor2
  * @param {RawVector} axis
  * @returns {RawGenericJoint | undefined}
  */
  static revolute(anchor1, anchor2, axis) {
    _assertClass(anchor1, RawVector);
    _assertClass(anchor2, RawVector);
    _assertClass(axis, RawVector);
    const ret = wasm.rawgenericjoint_revolute(anchor1.__wbg_ptr, anchor2.__wbg_ptr, axis.__wbg_ptr);
    return ret === 0 ? void 0 : _RawGenericJoint.__wrap(ret);
  }
};
var RawImpulseJointSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawimpulsejointset_free(ptr >>> 0));
var RawImpulseJointSet = class _RawImpulseJointSet {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawImpulseJointSet.prototype);
    obj.__wbg_ptr = ptr;
    RawImpulseJointSetFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawImpulseJointSetFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawimpulsejointset_free(ptr);
  }
  /**
  * The type of this joint.
  * @param {number} handle
  * @returns {RawJointType}
  */
  jointType(handle) {
    const ret = wasm.rawimpulsejointset_jointType(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The unique integer identifier of the first rigid-body this joint it attached to.
  * @param {number} handle
  * @returns {number}
  */
  jointBodyHandle1(handle) {
    const ret = wasm.rawimpulsejointset_jointBodyHandle1(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The unique integer identifier of the second rigid-body this joint is attached to.
  * @param {number} handle
  * @returns {number}
  */
  jointBodyHandle2(handle) {
    const ret = wasm.rawimpulsejointset_jointBodyHandle2(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The angular part of the joint’s local frame relative to the first rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawRotation}
  */
  jointFrameX1(handle) {
    const ret = wasm.rawimpulsejointset_jointFrameX1(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * The angular part of the joint’s local frame relative to the second rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawRotation}
  */
  jointFrameX2(handle) {
    const ret = wasm.rawimpulsejointset_jointFrameX2(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * The position of the first anchor of this joint.
  *
  * The first anchor gives the position of the points application point on the
  * local frame of the first rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawVector}
  */
  jointAnchor1(handle) {
    const ret = wasm.rawimpulsejointset_jointAnchor1(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The position of the second anchor of this joint.
  *
  * The second anchor gives the position of the points application point on the
  * local frame of the second rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawVector}
  */
  jointAnchor2(handle) {
    const ret = wasm.rawimpulsejointset_jointAnchor2(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * Sets the position of the first local anchor
  * @param {number} handle
  * @param {RawVector} newPos
  */
  jointSetAnchor1(handle, newPos) {
    _assertClass(newPos, RawVector);
    wasm.rawimpulsejointset_jointSetAnchor1(this.__wbg_ptr, handle, newPos.__wbg_ptr);
  }
  /**
  * Sets the position of the second local anchor
  * @param {number} handle
  * @param {RawVector} newPos
  */
  jointSetAnchor2(handle, newPos) {
    _assertClass(newPos, RawVector);
    wasm.rawimpulsejointset_jointSetAnchor2(this.__wbg_ptr, handle, newPos.__wbg_ptr);
  }
  /**
  * Are contacts between the rigid-bodies attached by this joint enabled?
  * @param {number} handle
  * @returns {boolean}
  */
  jointContactsEnabled(handle) {
    const ret = wasm.rawimpulsejointset_jointContactsEnabled(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Sets whether contacts are enabled between the rigid-bodies attached by this joint.
  * @param {number} handle
  * @param {boolean} enabled
  */
  jointSetContactsEnabled(handle, enabled) {
    wasm.rawimpulsejointset_jointSetContactsEnabled(this.__wbg_ptr, handle, enabled);
  }
  /**
  * Are the limits for this joint enabled?
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {boolean}
  */
  jointLimitsEnabled(handle, axis) {
    const ret = wasm.rawimpulsejointset_jointLimitsEnabled(this.__wbg_ptr, handle, axis);
    return ret !== 0;
  }
  /**
  * Return the lower limit along the given joint axis.
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {number}
  */
  jointLimitsMin(handle, axis) {
    const ret = wasm.rawimpulsejointset_jointLimitsMin(this.__wbg_ptr, handle, axis);
    return ret;
  }
  /**
  * If this is a prismatic joint, returns its upper limit.
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {number}
  */
  jointLimitsMax(handle, axis) {
    const ret = wasm.rawimpulsejointset_jointLimitsMax(this.__wbg_ptr, handle, axis);
    return ret;
  }
  /**
  * Enables and sets the joint limits
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @param {number} min
  * @param {number} max
  */
  jointSetLimits(handle, axis, min, max) {
    wasm.rawimpulsejointset_jointSetLimits(this.__wbg_ptr, handle, axis, min, max);
  }
  /**
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @param {RawMotorModel} model
  */
  jointConfigureMotorModel(handle, axis, model) {
    wasm.rawimpulsejointset_jointConfigureMotorModel(this.__wbg_ptr, handle, axis, model);
  }
  /**
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @param {number} targetVel
  * @param {number} factor
  */
  jointConfigureMotorVelocity(handle, axis, targetVel, factor) {
    wasm.rawimpulsejointset_jointConfigureMotorVelocity(this.__wbg_ptr, handle, axis, targetVel, factor);
  }
  /**
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @param {number} targetPos
  * @param {number} stiffness
  * @param {number} damping
  */
  jointConfigureMotorPosition(handle, axis, targetPos, stiffness, damping) {
    wasm.rawimpulsejointset_jointConfigureMotorPosition(this.__wbg_ptr, handle, axis, targetPos, stiffness, damping);
  }
  /**
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @param {number} targetPos
  * @param {number} targetVel
  * @param {number} stiffness
  * @param {number} damping
  */
  jointConfigureMotor(handle, axis, targetPos, targetVel, stiffness, damping) {
    wasm.rawimpulsejointset_jointConfigureMotor(this.__wbg_ptr, handle, axis, targetPos, targetVel, stiffness, damping);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawimpulsejointset_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {RawGenericJoint} params
  * @param {number} parent1
  * @param {number} parent2
  * @param {boolean} wake_up
  * @returns {number}
  */
  createJoint(params, parent1, parent2, wake_up) {
    _assertClass(params, RawGenericJoint);
    const ret = wasm.rawimpulsejointset_createJoint(this.__wbg_ptr, params.__wbg_ptr, parent1, parent2, wake_up);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {boolean} wakeUp
  */
  remove(handle, wakeUp) {
    wasm.rawimpulsejointset_remove(this.__wbg_ptr, handle, wakeUp);
  }
  /**
  * @returns {number}
  */
  len() {
    const ret = wasm.rawimpulsejointset_len(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} handle
  * @returns {boolean}
  */
  contains(handle) {
    const ret = wasm.rawimpulsejointset_contains(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Applies the given JavaScript function to the integer handle of each joint managed by this physics world.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each joint managed by this set. Called as `f(collider)`.
  * @param {Function} f
  */
  forEachJointHandle(f) {
    try {
      wasm.rawimpulsejointset_forEachJointHandle(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * Applies the given JavaScript function to the integer handle of each joint attached to the given rigid-body.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each joint attached to the rigid-body. Called as `f(collider)`.
  * @param {number} body
  * @param {Function} f
  */
  forEachJointAttachedToRigidBody(body, f) {
    try {
      wasm.rawimpulsejointset_forEachJointAttachedToRigidBody(this.__wbg_ptr, body, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
};
var RawIntegrationParametersFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawintegrationparameters_free(ptr >>> 0));
var RawIntegrationParameters = class _RawIntegrationParameters {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawIntegrationParameters.prototype);
    obj.__wbg_ptr = ptr;
    RawIntegrationParametersFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawIntegrationParametersFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawintegrationparameters_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawintegrationparameters_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {number}
  */
  get dt() {
    const ret = wasm.rawintegrationparameters_dt(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  get contact_erp() {
    const ret = wasm.rawintegrationparameters_contact_erp(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  get normalizedAllowedLinearError() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_current_vehicle_speed(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  get normalizedPredictionDistance() {
    const ret = wasm.rawcontactforceevent_max_force_magnitude(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  get numSolverIterations() {
    const ret = wasm.rawintegrationparameters_numSolverIterations(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  get numAdditionalFrictionIterations() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_index_up_axis(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  get numInternalPgsIterations() {
    const ret = wasm.rawdynamicraycastvehiclecontroller_index_forward_axis(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  get minIslandSize() {
    const ret = wasm.rawimpulsejointset_len(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  get maxCcdSubsteps() {
    const ret = wasm.rawintegrationparameters_maxCcdSubsteps(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @returns {number}
  */
  get lengthUnit() {
    const ret = wasm.rawintegrationparameters_lengthUnit(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} value
  */
  set dt(value) {
    wasm.rawintegrationparameters_set_dt(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set contact_natural_frequency(value) {
    wasm.rawintegrationparameters_set_contact_natural_frequency(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set normalizedAllowedLinearError(value) {
    wasm.rawintegrationparameters_set_normalizedAllowedLinearError(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set normalizedPredictionDistance(value) {
    wasm.rawintegrationparameters_set_normalizedPredictionDistance(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set numSolverIterations(value) {
    wasm.rawintegrationparameters_set_numSolverIterations(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set numAdditionalFrictionIterations(value) {
    wasm.rawdynamicraycastvehiclecontroller_set_index_up_axis(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set numInternalPgsIterations(value) {
    wasm.rawdynamicraycastvehiclecontroller_set_index_forward_axis(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set minIslandSize(value) {
    wasm.rawintegrationparameters_set_minIslandSize(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set maxCcdSubsteps(value) {
    wasm.rawintegrationparameters_set_maxCcdSubsteps(this.__wbg_ptr, value);
  }
  /**
  * @param {number} value
  */
  set lengthUnit(value) {
    wasm.rawintegrationparameters_set_lengthUnit(this.__wbg_ptr, value);
  }
  /**
  */
  switchToStandardPgsSolver() {
    wasm.rawintegrationparameters_switchToStandardPgsSolver(this.__wbg_ptr);
  }
  /**
  */
  switchToSmallStepsPgsSolver() {
    wasm.rawintegrationparameters_switchToSmallStepsPgsSolver(this.__wbg_ptr);
  }
  /**
  */
  switchToSmallStepsPgsSolverWithoutWarmstart() {
    wasm.rawintegrationparameters_switchToSmallStepsPgsSolverWithoutWarmstart(this.__wbg_ptr);
  }
};
var RawIslandManagerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawislandmanager_free(ptr >>> 0));
var RawIslandManager = class _RawIslandManager {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawIslandManager.prototype);
    obj.__wbg_ptr = ptr;
    RawIslandManagerFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawIslandManagerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawislandmanager_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawislandmanager_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * Applies the given JavaScript function to the integer handle of each active rigid-body
  * managed by this island manager.
  *
  * After a short time of inactivity, a rigid-body is automatically deactivated ("asleep") by
  * the physics engine in order to save computational power. A sleeping rigid-body never moves
  * unless it is moved manually by the user.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each active rigid-body managed by this
  *   set. Called as `f(collider)`.
  * @param {Function} f
  */
  forEachActiveRigidBodyHandle(f) {
    try {
      wasm.rawislandmanager_forEachActiveRigidBodyHandle(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
};
var RawKinematicCharacterControllerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawkinematiccharactercontroller_free(ptr >>> 0));
var RawKinematicCharacterController = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawKinematicCharacterControllerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawkinematiccharactercontroller_free(ptr);
  }
  /**
  * @param {number} offset
  */
  constructor(offset) {
    const ret = wasm.rawkinematiccharactercontroller_new(offset);
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @returns {RawVector}
  */
  up() {
    const ret = wasm.rawcharactercollision_translationDeltaApplied(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @param {RawVector} vector
  */
  setUp(vector) {
    _assertClass(vector, RawVector);
    wasm.rawkinematiccharactercontroller_setUp(this.__wbg_ptr, vector.__wbg_ptr);
  }
  /**
  * @returns {number}
  */
  normalNudgeFactor() {
    const ret = wasm.rawkinematiccharactercontroller_normalNudgeFactor(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} value
  */
  setNormalNudgeFactor(value) {
    wasm.rawkinematiccharactercontroller_setNormalNudgeFactor(this.__wbg_ptr, value);
  }
  /**
  * @returns {number}
  */
  offset() {
    const ret = wasm.rawintegrationparameters_dt(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} value
  */
  setOffset(value) {
    wasm.rawkinematiccharactercontroller_setOffset(this.__wbg_ptr, value);
  }
  /**
  * @returns {boolean}
  */
  slideEnabled() {
    const ret = wasm.rawkinematiccharactercontroller_slideEnabled(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {boolean} enabled
  */
  setSlideEnabled(enabled) {
    wasm.rawkinematiccharactercontroller_setSlideEnabled(this.__wbg_ptr, enabled);
  }
  /**
  * @returns {number | undefined}
  */
  autostepMaxHeight() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawkinematiccharactercontroller_autostepMaxHeight(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @returns {number | undefined}
  */
  autostepMinWidth() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawkinematiccharactercontroller_autostepMinWidth(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @returns {boolean | undefined}
  */
  autostepIncludesDynamicBodies() {
    const ret = wasm.rawkinematiccharactercontroller_autostepIncludesDynamicBodies(this.__wbg_ptr);
    return ret === 16777215 ? void 0 : ret !== 0;
  }
  /**
  * @returns {boolean}
  */
  autostepEnabled() {
    const ret = wasm.rawkinematiccharactercontroller_autostepEnabled(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {number} maxHeight
  * @param {number} minWidth
  * @param {boolean} includeDynamicBodies
  */
  enableAutostep(maxHeight, minWidth, includeDynamicBodies) {
    wasm.rawkinematiccharactercontroller_enableAutostep(this.__wbg_ptr, maxHeight, minWidth, includeDynamicBodies);
  }
  /**
  */
  disableAutostep() {
    wasm.rawkinematiccharactercontroller_disableAutostep(this.__wbg_ptr);
  }
  /**
  * @returns {number}
  */
  maxSlopeClimbAngle() {
    const ret = wasm.rawkinematiccharactercontroller_maxSlopeClimbAngle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} angle
  */
  setMaxSlopeClimbAngle(angle) {
    wasm.rawkinematiccharactercontroller_setMaxSlopeClimbAngle(this.__wbg_ptr, angle);
  }
  /**
  * @returns {number}
  */
  minSlopeSlideAngle() {
    const ret = wasm.rawkinematiccharactercontroller_minSlopeSlideAngle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @param {number} angle
  */
  setMinSlopeSlideAngle(angle) {
    wasm.rawkinematiccharactercontroller_setMinSlopeSlideAngle(this.__wbg_ptr, angle);
  }
  /**
  * @returns {number | undefined}
  */
  snapToGroundDistance() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawkinematiccharactercontroller_snapToGroundDistance(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getFloat32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
  * @param {number} distance
  */
  enableSnapToGround(distance) {
    wasm.rawkinematiccharactercontroller_enableSnapToGround(this.__wbg_ptr, distance);
  }
  /**
  */
  disableSnapToGround() {
    wasm.rawkinematiccharactercontroller_disableSnapToGround(this.__wbg_ptr);
  }
  /**
  * @returns {boolean}
  */
  snapToGroundEnabled() {
    const ret = wasm.rawkinematiccharactercontroller_snapToGroundEnabled(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {number} dt
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawQueryPipeline} queries
  * @param {number} collider_handle
  * @param {RawVector} desired_translation_delta
  * @param {boolean} apply_impulses_to_dynamic_bodies
  * @param {number | undefined} character_mass
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {Function} filter_predicate
  */
  computeColliderMovement(dt, bodies, colliders, queries, collider_handle, desired_translation_delta, apply_impulses_to_dynamic_bodies, character_mass, filter_flags, filter_groups, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(queries, RawQueryPipeline);
      _assertClass(desired_translation_delta, RawVector);
      wasm.rawkinematiccharactercontroller_computeColliderMovement(this.__wbg_ptr, dt, bodies.__wbg_ptr, colliders.__wbg_ptr, queries.__wbg_ptr, collider_handle, desired_translation_delta.__wbg_ptr, apply_impulses_to_dynamic_bodies, !isLikeNone(character_mass), isLikeNone(character_mass) ? 0 : character_mass, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, addBorrowedObject(filter_predicate));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @returns {RawVector}
  */
  computedMovement() {
    const ret = wasm.rawkinematiccharactercontroller_computedMovement(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {boolean}
  */
  computedGrounded() {
    const ret = wasm.rawkinematiccharactercontroller_computedGrounded(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @returns {number}
  */
  numComputedCollisions() {
    const ret = wasm.rawkinematiccharactercontroller_numComputedCollisions(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * @param {number} i
  * @param {RawCharacterCollision} collision
  * @returns {boolean}
  */
  computedCollision(i, collision) {
    _assertClass(collision, RawCharacterCollision);
    const ret = wasm.rawkinematiccharactercontroller_computedCollision(this.__wbg_ptr, i, collision.__wbg_ptr);
    return ret !== 0;
  }
};
var RawMultibodyJointSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawmultibodyjointset_free(ptr >>> 0));
var RawMultibodyJointSet = class _RawMultibodyJointSet {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawMultibodyJointSet.prototype);
    obj.__wbg_ptr = ptr;
    RawMultibodyJointSetFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawMultibodyJointSetFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawmultibodyjointset_free(ptr);
  }
  /**
  * The type of this joint.
  * @param {number} handle
  * @returns {RawJointType}
  */
  jointType(handle) {
    const ret = wasm.rawmultibodyjointset_jointType(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The angular part of the joint’s local frame relative to the first rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawRotation}
  */
  jointFrameX1(handle) {
    const ret = wasm.rawmultibodyjointset_jointFrameX1(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * The angular part of the joint’s local frame relative to the second rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawRotation}
  */
  jointFrameX2(handle) {
    const ret = wasm.rawmultibodyjointset_jointFrameX2(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * The position of the first anchor of this joint.
  *
  * The first anchor gives the position of the points application point on the
  * local frame of the first rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawVector}
  */
  jointAnchor1(handle) {
    const ret = wasm.rawmultibodyjointset_jointAnchor1(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The position of the second anchor of this joint.
  *
  * The second anchor gives the position of the points application point on the
  * local frame of the second rigid-body it is attached to.
  * @param {number} handle
  * @returns {RawVector}
  */
  jointAnchor2(handle) {
    const ret = wasm.rawmultibodyjointset_jointAnchor2(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * Are contacts between the rigid-bodies attached by this joint enabled?
  * @param {number} handle
  * @returns {boolean}
  */
  jointContactsEnabled(handle) {
    const ret = wasm.rawmultibodyjointset_jointContactsEnabled(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Sets whether contacts are enabled between the rigid-bodies attached by this joint.
  * @param {number} handle
  * @param {boolean} enabled
  */
  jointSetContactsEnabled(handle, enabled) {
    wasm.rawmultibodyjointset_jointSetContactsEnabled(this.__wbg_ptr, handle, enabled);
  }
  /**
  * Are the limits for this joint enabled?
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {boolean}
  */
  jointLimitsEnabled(handle, axis) {
    const ret = wasm.rawmultibodyjointset_jointLimitsEnabled(this.__wbg_ptr, handle, axis);
    return ret !== 0;
  }
  /**
  * Return the lower limit along the given joint axis.
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {number}
  */
  jointLimitsMin(handle, axis) {
    const ret = wasm.rawmultibodyjointset_jointLimitsMin(this.__wbg_ptr, handle, axis);
    return ret;
  }
  /**
  * If this is a prismatic joint, returns its upper limit.
  * @param {number} handle
  * @param {RawJointAxis} axis
  * @returns {number}
  */
  jointLimitsMax(handle, axis) {
    const ret = wasm.rawmultibodyjointset_jointLimitsMax(this.__wbg_ptr, handle, axis);
    return ret;
  }
  /**
  */
  constructor() {
    const ret = wasm.rawmultibodyjointset_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {RawGenericJoint} params
  * @param {number} parent1
  * @param {number} parent2
  * @param {boolean} wakeUp
  * @returns {number}
  */
  createJoint(params, parent1, parent2, wakeUp) {
    _assertClass(params, RawGenericJoint);
    const ret = wasm.rawmultibodyjointset_createJoint(this.__wbg_ptr, params.__wbg_ptr, parent1, parent2, wakeUp);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {boolean} wakeUp
  */
  remove(handle, wakeUp) {
    wasm.rawmultibodyjointset_remove(this.__wbg_ptr, handle, wakeUp);
  }
  /**
  * @param {number} handle
  * @returns {boolean}
  */
  contains(handle) {
    const ret = wasm.rawmultibodyjointset_contains(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Applies the given JavaScript function to the integer handle of each joint managed by this physics world.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each joint managed by this set. Called as `f(collider)`.
  * @param {Function} f
  */
  forEachJointHandle(f) {
    try {
      wasm.rawmultibodyjointset_forEachJointHandle(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * Applies the given JavaScript function to the integer handle of each joint attached to the given rigid-body.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each joint attached to the rigid-body. Called as `f(collider)`.
  * @param {number} body
  * @param {Function} f
  */
  forEachJointAttachedToRigidBody(body, f) {
    try {
      wasm.rawmultibodyjointset_forEachJointAttachedToRigidBody(this.__wbg_ptr, body, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
};
var RawNarrowPhaseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawnarrowphase_free(ptr >>> 0));
var RawNarrowPhase = class _RawNarrowPhase {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawNarrowPhase.prototype);
    obj.__wbg_ptr = ptr;
    RawNarrowPhaseFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawNarrowPhaseFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawnarrowphase_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawnarrowphase_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {number} handle1
  * @param {Function} f
  */
  contact_pairs_with(handle1, f) {
    wasm.rawnarrowphase_contact_pairs_with(this.__wbg_ptr, handle1, addHeapObject(f));
  }
  /**
  * @param {number} handle1
  * @param {number} handle2
  * @returns {RawContactPair | undefined}
  */
  contact_pair(handle1, handle2) {
    const ret = wasm.rawnarrowphase_contact_pair(this.__wbg_ptr, handle1, handle2);
    return ret === 0 ? void 0 : RawContactPair.__wrap(ret);
  }
  /**
  * @param {number} handle1
  * @param {Function} f
  */
  intersection_pairs_with(handle1, f) {
    wasm.rawnarrowphase_intersection_pairs_with(this.__wbg_ptr, handle1, addHeapObject(f));
  }
  /**
  * @param {number} handle1
  * @param {number} handle2
  * @returns {boolean}
  */
  intersection_pair(handle1, handle2) {
    const ret = wasm.rawnarrowphase_intersection_pair(this.__wbg_ptr, handle1, handle2);
    return ret !== 0;
  }
};
var RawPhysicsPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawphysicspipeline_free(ptr >>> 0));
var RawPhysicsPipeline = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawPhysicsPipelineFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawphysicspipeline_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawphysicspipeline_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {RawVector} gravity
  * @param {RawIntegrationParameters} integrationParameters
  * @param {RawIslandManager} islands
  * @param {RawBroadPhase} broadPhase
  * @param {RawNarrowPhase} narrowPhase
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawImpulseJointSet} joints
  * @param {RawMultibodyJointSet} articulations
  * @param {RawCCDSolver} ccd_solver
  */
  step(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, joints, articulations, ccd_solver) {
    _assertClass(gravity, RawVector);
    _assertClass(integrationParameters, RawIntegrationParameters);
    _assertClass(islands, RawIslandManager);
    _assertClass(broadPhase, RawBroadPhase);
    _assertClass(narrowPhase, RawNarrowPhase);
    _assertClass(bodies, RawRigidBodySet);
    _assertClass(colliders, RawColliderSet);
    _assertClass(joints, RawImpulseJointSet);
    _assertClass(articulations, RawMultibodyJointSet);
    _assertClass(ccd_solver, RawCCDSolver);
    wasm.rawphysicspipeline_step(this.__wbg_ptr, gravity.__wbg_ptr, integrationParameters.__wbg_ptr, islands.__wbg_ptr, broadPhase.__wbg_ptr, narrowPhase.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, joints.__wbg_ptr, articulations.__wbg_ptr, ccd_solver.__wbg_ptr);
  }
  /**
  * @param {RawVector} gravity
  * @param {RawIntegrationParameters} integrationParameters
  * @param {RawIslandManager} islands
  * @param {RawBroadPhase} broadPhase
  * @param {RawNarrowPhase} narrowPhase
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawImpulseJointSet} joints
  * @param {RawMultibodyJointSet} articulations
  * @param {RawCCDSolver} ccd_solver
  * @param {RawEventQueue} eventQueue
  * @param {object} hookObject
  * @param {Function} hookFilterContactPair
  * @param {Function} hookFilterIntersectionPair
  */
  stepWithEvents(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, joints, articulations, ccd_solver, eventQueue, hookObject, hookFilterContactPair, hookFilterIntersectionPair) {
    _assertClass(gravity, RawVector);
    _assertClass(integrationParameters, RawIntegrationParameters);
    _assertClass(islands, RawIslandManager);
    _assertClass(broadPhase, RawBroadPhase);
    _assertClass(narrowPhase, RawNarrowPhase);
    _assertClass(bodies, RawRigidBodySet);
    _assertClass(colliders, RawColliderSet);
    _assertClass(joints, RawImpulseJointSet);
    _assertClass(articulations, RawMultibodyJointSet);
    _assertClass(ccd_solver, RawCCDSolver);
    _assertClass(eventQueue, RawEventQueue);
    wasm.rawphysicspipeline_stepWithEvents(this.__wbg_ptr, gravity.__wbg_ptr, integrationParameters.__wbg_ptr, islands.__wbg_ptr, broadPhase.__wbg_ptr, narrowPhase.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, joints.__wbg_ptr, articulations.__wbg_ptr, ccd_solver.__wbg_ptr, eventQueue.__wbg_ptr, addHeapObject(hookObject), addHeapObject(hookFilterContactPair), addHeapObject(hookFilterIntersectionPair));
  }
};
var RawPointColliderProjectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawpointcolliderprojection_free(ptr >>> 0));
var RawPointColliderProjection = class _RawPointColliderProjection {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawPointColliderProjection.prototype);
    obj.__wbg_ptr = ptr;
    RawPointColliderProjectionFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawPointColliderProjectionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawpointcolliderprojection_free(ptr);
  }
  /**
  * @returns {number}
  */
  colliderHandle() {
    const ret = wasm.rawpointcolliderprojection_colliderHandle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  point() {
    const ret = wasm.rawpointcolliderprojection_point(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {boolean}
  */
  isInside() {
    const ret = wasm.rawpointcolliderprojection_isInside(this.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @returns {RawFeatureType}
  */
  featureType() {
    const ret = wasm.rawpointcolliderprojection_featureType(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number | undefined}
  */
  featureId() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawpointcolliderprojection_featureId(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
var RawPointProjectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawpointprojection_free(ptr >>> 0));
var RawPointProjection = class _RawPointProjection {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawPointProjection.prototype);
    obj.__wbg_ptr = ptr;
    RawPointProjectionFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawPointProjectionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawpointprojection_free(ptr);
  }
  /**
  * @returns {RawVector}
  */
  point() {
    const ret = wasm.rawpointprojection_point(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {boolean}
  */
  isInside() {
    const ret = wasm.rawpointprojection_isInside(this.__wbg_ptr);
    return ret !== 0;
  }
};
var RawQueryPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawquerypipeline_free(ptr >>> 0));
var RawQueryPipeline = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawQueryPipelineFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawquerypipeline_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawquerypipeline_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {RawColliderSet} colliders
  */
  update(colliders) {
    _assertClass(colliders, RawColliderSet);
    wasm.rawquerypipeline_update(this.__wbg_ptr, colliders.__wbg_ptr);
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {RawRayColliderHit | undefined}
  */
  castRay(bodies, colliders, rayOrig, rayDir, maxToi, solid, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(rayOrig, RawVector);
      _assertClass(rayDir, RawVector);
      const ret = wasm.rawquerypipeline_castRay(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      return ret === 0 ? void 0 : RawRayColliderHit.__wrap(ret);
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {RawRayColliderIntersection | undefined}
  */
  castRayAndGetNormal(bodies, colliders, rayOrig, rayDir, maxToi, solid, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(rayOrig, RawVector);
      _assertClass(rayDir, RawVector);
      const ret = wasm.rawquerypipeline_castRayAndGetNormal(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      return ret === 0 ? void 0 : RawRayColliderIntersection.__wrap(ret);
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @param {Function} callback
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  */
  intersectionsWithRay(bodies, colliders, rayOrig, rayDir, maxToi, solid, callback, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(rayOrig, RawVector);
      _assertClass(rayDir, RawVector);
      wasm.rawquerypipeline_intersectionsWithRay(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid, addBorrowedObject(callback), filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
    } finally {
      heap[stack_pointer++] = void 0;
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawShape} shape
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {number | undefined}
  */
  intersectionWithShape(bodies, colliders, shapePos, shapeRot, shape, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(shapePos, RawVector);
      _assertClass(shapeRot, RawRotation);
      _assertClass(shape, RawShape);
      wasm.rawquerypipeline_intersectionWithShape(retptr, this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, shape.__wbg_ptr, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r2 = getFloat64Memory0()[retptr / 8 + 1];
      return r0 === 0 ? void 0 : r2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} point
  * @param {boolean} solid
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {RawPointColliderProjection | undefined}
  */
  projectPoint(bodies, colliders, point, solid, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(point, RawVector);
      const ret = wasm.rawquerypipeline_projectPoint(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, point.__wbg_ptr, solid, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      return ret === 0 ? void 0 : RawPointColliderProjection.__wrap(ret);
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} point
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {RawPointColliderProjection | undefined}
  */
  projectPointAndGetFeature(bodies, colliders, point, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(point, RawVector);
      const ret = wasm.rawquerypipeline_projectPointAndGetFeature(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, point.__wbg_ptr, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      return ret === 0 ? void 0 : RawPointColliderProjection.__wrap(ret);
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} point
  * @param {Function} callback
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  */
  intersectionsWithPoint(bodies, colliders, point, callback, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(point, RawVector);
      wasm.rawquerypipeline_intersectionsWithPoint(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, point.__wbg_ptr, addBorrowedObject(callback), filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
    } finally {
      heap[stack_pointer++] = void 0;
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} shapeVel
  * @param {RawShape} shape
  * @param {number} target_distance
  * @param {number} maxToi
  * @param {boolean} stop_at_penetration
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  * @returns {RawColliderShapeCastHit | undefined}
  */
  castShape(bodies, colliders, shapePos, shapeRot, shapeVel, shape, target_distance, maxToi, stop_at_penetration, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(shapePos, RawVector);
      _assertClass(shapeRot, RawRotation);
      _assertClass(shapeVel, RawVector);
      _assertClass(shape, RawShape);
      const ret = wasm.rawquerypipeline_castShape(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, shapeVel.__wbg_ptr, shape.__wbg_ptr, target_distance, maxToi, stop_at_penetration, filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
      return ret === 0 ? void 0 : RawColliderShapeCastHit.__wrap(ret);
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawShape} shape
  * @param {Function} callback
  * @param {number} filter_flags
  * @param {number | undefined} filter_groups
  * @param {number | undefined} filter_exclude_collider
  * @param {number | undefined} filter_exclude_rigid_body
  * @param {Function} filter_predicate
  */
  intersectionsWithShape(bodies, colliders, shapePos, shapeRot, shape, callback, filter_flags, filter_groups, filter_exclude_collider, filter_exclude_rigid_body, filter_predicate) {
    try {
      _assertClass(bodies, RawRigidBodySet);
      _assertClass(colliders, RawColliderSet);
      _assertClass(shapePos, RawVector);
      _assertClass(shapeRot, RawRotation);
      _assertClass(shape, RawShape);
      wasm.rawquerypipeline_intersectionsWithShape(this.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, shape.__wbg_ptr, addBorrowedObject(callback), filter_flags, !isLikeNone(filter_groups), isLikeNone(filter_groups) ? 0 : filter_groups, !isLikeNone(filter_exclude_collider), isLikeNone(filter_exclude_collider) ? 0 : filter_exclude_collider, !isLikeNone(filter_exclude_rigid_body), isLikeNone(filter_exclude_rigid_body) ? 0 : filter_exclude_rigid_body, addBorrowedObject(filter_predicate));
    } finally {
      heap[stack_pointer++] = void 0;
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawVector} aabbCenter
  * @param {RawVector} aabbHalfExtents
  * @param {Function} callback
  */
  collidersWithAabbIntersectingAabb(aabbCenter, aabbHalfExtents, callback) {
    try {
      _assertClass(aabbCenter, RawVector);
      _assertClass(aabbHalfExtents, RawVector);
      wasm.rawquerypipeline_collidersWithAabbIntersectingAabb(this.__wbg_ptr, aabbCenter.__wbg_ptr, aabbHalfExtents.__wbg_ptr, addBorrowedObject(callback));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
};
var RawRayColliderHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawraycolliderhit_free(ptr >>> 0));
var RawRayColliderHit = class _RawRayColliderHit {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawRayColliderHit.prototype);
    obj.__wbg_ptr = ptr;
    RawRayColliderHitFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawRayColliderHitFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawraycolliderhit_free(ptr);
  }
  /**
  * @returns {number}
  */
  colliderHandle() {
    const ret = wasm.rawcharactercollision_handle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number}
  */
  timeOfImpact() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
};
var RawRayColliderIntersectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawraycolliderintersection_free(ptr >>> 0));
var RawRayColliderIntersection = class _RawRayColliderIntersection {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawRayColliderIntersection.prototype);
    obj.__wbg_ptr = ptr;
    RawRayColliderIntersectionFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawRayColliderIntersectionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawraycolliderintersection_free(ptr);
  }
  /**
  * @returns {number}
  */
  colliderHandle() {
    const ret = wasm.rawpointcolliderprojection_colliderHandle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  normal() {
    const ret = wasm.rawcollidershapecasthit_witness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {number}
  */
  time_of_impact() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawFeatureType}
  */
  featureType() {
    const ret = wasm.rawpointcolliderprojection_featureType(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number | undefined}
  */
  featureId() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawpointcolliderprojection_featureId(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
var RawRayIntersectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrayintersection_free(ptr >>> 0));
var RawRayIntersection = class _RawRayIntersection {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawRayIntersection.prototype);
    obj.__wbg_ptr = ptr;
    RawRayIntersectionFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawRayIntersectionFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawrayintersection_free(ptr);
  }
  /**
  * @returns {RawVector}
  */
  normal() {
    const ret = wasm.rawcollidershapecasthit_witness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {number}
  */
  time_of_impact() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawFeatureType}
  */
  featureType() {
    const ret = wasm.rawpointcolliderprojection_featureType(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {number | undefined}
  */
  featureId() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.rawpointcolliderprojection_featureId(retptr, this.__wbg_ptr);
      var r0 = getInt32Memory0()[retptr / 4 + 0];
      var r1 = getInt32Memory0()[retptr / 4 + 1];
      return r0 === 0 ? void 0 : r1 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
};
var RawRigidBodySetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrigidbodyset_free(ptr >>> 0));
var RawRigidBodySet = class _RawRigidBodySet {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawRigidBodySet.prototype);
    obj.__wbg_ptr = ptr;
    RawRigidBodySetFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawRigidBodySetFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawrigidbodyset_free(ptr);
  }
  /**
  * The world-space translation of this rigid-body.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbTranslation(handle) {
    const ret = wasm.rawrigidbodyset_rbTranslation(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The world-space orientation of this rigid-body.
  * @param {number} handle
  * @returns {RawRotation}
  */
  rbRotation(handle) {
    const ret = wasm.rawrigidbodyset_rbRotation(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * Put the given rigid-body to sleep.
  * @param {number} handle
  */
  rbSleep(handle) {
    wasm.rawrigidbodyset_rbSleep(this.__wbg_ptr, handle);
  }
  /**
  * Is this rigid-body sleeping?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsSleeping(handle) {
    const ret = wasm.rawrigidbodyset_rbIsSleeping(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Is the velocity of this rigid-body not zero?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsMoving(handle) {
    const ret = wasm.rawrigidbodyset_rbIsMoving(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * The world-space predicted translation of this rigid-body.
  *
  * If this rigid-body is kinematic this value is set by the `setNextKinematicTranslation`
  * method and is used for estimating the kinematic body velocity at the next timestep.
  * For non-kinematic bodies, this value is currently unspecified.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbNextTranslation(handle) {
    const ret = wasm.rawrigidbodyset_rbNextTranslation(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The world-space predicted orientation of this rigid-body.
  *
  * If this rigid-body is kinematic this value is set by the `setNextKinematicRotation`
  * method and is used for estimating the kinematic body velocity at the next timestep.
  * For non-kinematic bodies, this value is currently unspecified.
  * @param {number} handle
  * @returns {RawRotation}
  */
  rbNextRotation(handle) {
    const ret = wasm.rawrigidbodyset_rbNextRotation(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * Sets the translation of this rigid-body.
  *
  * # Parameters
  * - `x`: the world-space position of the rigid-body along the `x` axis.
  * - `y`: the world-space position of the rigid-body along the `y` axis.
  * - `z`: the world-space position of the rigid-body along the `z` axis.
  * - `wakeUp`: forces the rigid-body to wake-up so it is properly affected by forces if it
  * wasn't moving before modifying its position.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {boolean} wakeUp
  */
  rbSetTranslation(handle, x, y, z, wakeUp) {
    wasm.rawrigidbodyset_rbSetTranslation(this.__wbg_ptr, handle, x, y, z, wakeUp);
  }
  /**
  * Sets the rotation quaternion of this rigid-body.
  *
  * This does nothing if a zero quaternion is provided.
  *
  * # Parameters
  * - `x`: the first vector component of the quaternion.
  * - `y`: the second vector component of the quaternion.
  * - `z`: the third vector component of the quaternion.
  * - `w`: the scalar component of the quaternion.
  * - `wakeUp`: forces the rigid-body to wake-up so it is properly affected by forces if it
  * wasn't moving before modifying its position.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {number} w
  * @param {boolean} wakeUp
  */
  rbSetRotation(handle, x, y, z, w, wakeUp) {
    wasm.rawrigidbodyset_rbSetRotation(this.__wbg_ptr, handle, x, y, z, w, wakeUp);
  }
  /**
  * Sets the linear velocity of this rigid-body.
  * @param {number} handle
  * @param {RawVector} linvel
  * @param {boolean} wakeUp
  */
  rbSetLinvel(handle, linvel, wakeUp) {
    _assertClass(linvel, RawVector);
    wasm.rawrigidbodyset_rbSetLinvel(this.__wbg_ptr, handle, linvel.__wbg_ptr, wakeUp);
  }
  /**
  * Sets the angular velocity of this rigid-body.
  * @param {number} handle
  * @param {RawVector} angvel
  * @param {boolean} wakeUp
  */
  rbSetAngvel(handle, angvel, wakeUp) {
    _assertClass(angvel, RawVector);
    wasm.rawrigidbodyset_rbSetAngvel(this.__wbg_ptr, handle, angvel.__wbg_ptr, wakeUp);
  }
  /**
  * If this rigid body is kinematic, sets its future translation after the next timestep integration.
  *
  * This should be used instead of `rigidBody.setTranslation` to make the dynamic object
  * interacting with this kinematic body behave as expected. Internally, Rapier will compute
  * an artificial velocity for this rigid-body from its current position and its next kinematic
  * position. This velocity will be used to compute forces on dynamic bodies interacting with
  * this body.
  *
  * # Parameters
  * - `x`: the world-space position of the rigid-body along the `x` axis.
  * - `y`: the world-space position of the rigid-body along the `y` axis.
  * - `z`: the world-space position of the rigid-body along the `z` axis.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  */
  rbSetNextKinematicTranslation(handle, x, y, z) {
    wasm.rawrigidbodyset_rbSetNextKinematicTranslation(this.__wbg_ptr, handle, x, y, z);
  }
  /**
  * If this rigid body is kinematic, sets its future rotation after the next timestep integration.
  *
  * This should be used instead of `rigidBody.setRotation` to make the dynamic object
  * interacting with this kinematic body behave as expected. Internally, Rapier will compute
  * an artificial velocity for this rigid-body from its current position and its next kinematic
  * position. This velocity will be used to compute forces on dynamic bodies interacting with
  * this body.
  *
  * # Parameters
  * - `x`: the first vector component of the quaternion.
  * - `y`: the second vector component of the quaternion.
  * - `z`: the third vector component of the quaternion.
  * - `w`: the scalar component of the quaternion.
  * @param {number} handle
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {number} w
  */
  rbSetNextKinematicRotation(handle, x, y, z, w) {
    wasm.rawrigidbodyset_rbSetNextKinematicRotation(this.__wbg_ptr, handle, x, y, z, w);
  }
  /**
  * @param {number} handle
  * @param {RawColliderSet} colliders
  */
  rbRecomputeMassPropertiesFromColliders(handle, colliders) {
    _assertClass(colliders, RawColliderSet);
    wasm.rawrigidbodyset_rbRecomputeMassPropertiesFromColliders(this.__wbg_ptr, handle, colliders.__wbg_ptr);
  }
  /**
  * @param {number} handle
  * @param {number} mass
  * @param {boolean} wake_up
  */
  rbSetAdditionalMass(handle, mass, wake_up) {
    wasm.rawrigidbodyset_rbSetAdditionalMass(this.__wbg_ptr, handle, mass, wake_up);
  }
  /**
  * @param {number} handle
  * @param {number} mass
  * @param {RawVector} centerOfMass
  * @param {RawVector} principalAngularInertia
  * @param {RawRotation} angularInertiaFrame
  * @param {boolean} wake_up
  */
  rbSetAdditionalMassProperties(handle, mass, centerOfMass, principalAngularInertia, angularInertiaFrame, wake_up) {
    _assertClass(centerOfMass, RawVector);
    _assertClass(principalAngularInertia, RawVector);
    _assertClass(angularInertiaFrame, RawRotation);
    wasm.rawrigidbodyset_rbSetAdditionalMassProperties(this.__wbg_ptr, handle, mass, centerOfMass.__wbg_ptr, principalAngularInertia.__wbg_ptr, angularInertiaFrame.__wbg_ptr, wake_up);
  }
  /**
  * The linear velocity of this rigid-body.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbLinvel(handle) {
    const ret = wasm.rawrigidbodyset_rbLinvel(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The angular velocity of this rigid-body.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbAngvel(handle) {
    const ret = wasm.rawrigidbodyset_rbAngvel(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * @param {number} handle
  * @param {boolean} locked
  * @param {boolean} wake_up
  */
  rbLockTranslations(handle, locked, wake_up) {
    wasm.rawrigidbodyset_rbLockTranslations(this.__wbg_ptr, handle, locked, wake_up);
  }
  /**
  * @param {number} handle
  * @param {boolean} allow_x
  * @param {boolean} allow_y
  * @param {boolean} allow_z
  * @param {boolean} wake_up
  */
  rbSetEnabledTranslations(handle, allow_x, allow_y, allow_z, wake_up) {
    wasm.rawrigidbodyset_rbSetEnabledTranslations(this.__wbg_ptr, handle, allow_x, allow_y, allow_z, wake_up);
  }
  /**
  * @param {number} handle
  * @param {boolean} locked
  * @param {boolean} wake_up
  */
  rbLockRotations(handle, locked, wake_up) {
    wasm.rawrigidbodyset_rbLockRotations(this.__wbg_ptr, handle, locked, wake_up);
  }
  /**
  * @param {number} handle
  * @param {boolean} allow_x
  * @param {boolean} allow_y
  * @param {boolean} allow_z
  * @param {boolean} wake_up
  */
  rbSetEnabledRotations(handle, allow_x, allow_y, allow_z, wake_up) {
    wasm.rawrigidbodyset_rbSetEnabledRotations(this.__wbg_ptr, handle, allow_x, allow_y, allow_z, wake_up);
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  rbDominanceGroup(handle) {
    const ret = wasm.rawrigidbodyset_rbDominanceGroup(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {number} group
  */
  rbSetDominanceGroup(handle, group) {
    wasm.rawrigidbodyset_rbSetDominanceGroup(this.__wbg_ptr, handle, group);
  }
  /**
  * @param {number} handle
  * @param {boolean} enabled
  */
  rbEnableCcd(handle, enabled) {
    wasm.rawrigidbodyset_rbEnableCcd(this.__wbg_ptr, handle, enabled);
  }
  /**
  * @param {number} handle
  * @param {number} prediction
  */
  rbSetSoftCcdPrediction(handle, prediction) {
    wasm.rawrigidbodyset_rbSetSoftCcdPrediction(this.__wbg_ptr, handle, prediction);
  }
  /**
  * The mass of this rigid-body.
  * @param {number} handle
  * @returns {number}
  */
  rbMass(handle) {
    const ret = wasm.rawrigidbodyset_rbMass(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The inverse of the mass of a rigid-body.
  *
  * If this is zero, the rigid-body is assumed to have infinite mass.
  * @param {number} handle
  * @returns {number}
  */
  rbInvMass(handle) {
    const ret = wasm.rawrigidbodyset_rbInvMass(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The inverse mass taking into account translation locking.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbEffectiveInvMass(handle) {
    const ret = wasm.rawrigidbodyset_rbEffectiveInvMass(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The center of mass of a rigid-body expressed in its local-space.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbLocalCom(handle) {
    const ret = wasm.rawrigidbodyset_rbLocalCom(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The world-space center of mass of the rigid-body.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbWorldCom(handle) {
    const ret = wasm.rawrigidbodyset_rbWorldCom(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The inverse of the principal angular inertia of the rigid-body.
  *
  * Components set to zero are assumed to be infinite along the corresponding principal axis.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbInvPrincipalInertiaSqrt(handle) {
    const ret = wasm.rawrigidbodyset_rbInvPrincipalInertiaSqrt(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The principal vectors of the local angular inertia tensor of the rigid-body.
  * @param {number} handle
  * @returns {RawRotation}
  */
  rbPrincipalInertiaLocalFrame(handle) {
    const ret = wasm.rawrigidbodyset_rbPrincipalInertiaLocalFrame(this.__wbg_ptr, handle);
    return RawRotation.__wrap(ret);
  }
  /**
  * The angular inertia along the principal inertia axes of the rigid-body.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbPrincipalInertia(handle) {
    const ret = wasm.rawrigidbodyset_rbPrincipalInertia(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * The square-root of the world-space inverse angular inertia tensor of the rigid-body,
  * taking into account rotation locking.
  * @param {number} handle
  * @returns {RawSdpMatrix3}
  */
  rbEffectiveWorldInvInertiaSqrt(handle) {
    const ret = wasm.rawrigidbodyset_rbEffectiveWorldInvInertiaSqrt(this.__wbg_ptr, handle);
    return RawSdpMatrix3.__wrap(ret);
  }
  /**
  * The effective world-space angular inertia (that takes the potential rotation locking into account) of
  * this rigid-body.
  * @param {number} handle
  * @returns {RawSdpMatrix3}
  */
  rbEffectiveAngularInertia(handle) {
    const ret = wasm.rawrigidbodyset_rbEffectiveAngularInertia(this.__wbg_ptr, handle);
    return RawSdpMatrix3.__wrap(ret);
  }
  /**
  * Wakes this rigid-body up.
  *
  * A dynamic rigid-body that does not move during several consecutive frames will
  * be put to sleep by the physics engine, i.e., it will stop being simulated in order
  * to avoid useless computations.
  * This method forces a sleeping rigid-body to wake-up. This is useful, e.g., before modifying
  * the position of a dynamic body so that it is properly simulated afterwards.
  * @param {number} handle
  */
  rbWakeUp(handle) {
    wasm.rawrigidbodyset_rbWakeUp(this.__wbg_ptr, handle);
  }
  /**
  * Is Continuous Collision Detection enabled for this rigid-body?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsCcdEnabled(handle) {
    const ret = wasm.rawrigidbodyset_rbIsCcdEnabled(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  rbSoftCcdPrediction(handle) {
    const ret = wasm.rawrigidbodyset_rbSoftCcdPrediction(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The number of colliders attached to this rigid-body.
  * @param {number} handle
  * @returns {number}
  */
  rbNumColliders(handle) {
    const ret = wasm.rawrigidbodyset_rbNumColliders(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * Retrieves the `i-th` collider attached to this rigid-body.
  *
  * # Parameters
  * - `at`: The index of the collider to retrieve. Must be a number in `[0, this.numColliders()[`.
  *         This index is **not** the same as the unique identifier of the collider.
  * @param {number} handle
  * @param {number} at
  * @returns {number}
  */
  rbCollider(handle, at) {
    const ret = wasm.rawrigidbodyset_rbCollider(this.__wbg_ptr, handle, at);
    return ret;
  }
  /**
  * The status of this rigid-body: fixed, dynamic, or kinematic.
  * @param {number} handle
  * @returns {RawRigidBodyType}
  */
  rbBodyType(handle) {
    const ret = wasm.rawrigidbodyset_rbBodyType(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * Set a new status for this rigid-body: fixed, dynamic, or kinematic.
  * @param {number} handle
  * @param {RawRigidBodyType} status
  * @param {boolean} wake_up
  */
  rbSetBodyType(handle, status, wake_up) {
    wasm.rawrigidbodyset_rbSetBodyType(this.__wbg_ptr, handle, status, wake_up);
  }
  /**
  * Is this rigid-body fixed?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsFixed(handle) {
    const ret = wasm.rawrigidbodyset_rbIsFixed(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Is this rigid-body kinematic?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsKinematic(handle) {
    const ret = wasm.rawrigidbodyset_rbIsKinematic(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Is this rigid-body dynamic?
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsDynamic(handle) {
    const ret = wasm.rawrigidbodyset_rbIsDynamic(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * The linear damping coefficient of this rigid-body.
  * @param {number} handle
  * @returns {number}
  */
  rbLinearDamping(handle) {
    const ret = wasm.rawrigidbodyset_rbLinearDamping(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * The angular damping coefficient of this rigid-body.
  * @param {number} handle
  * @returns {number}
  */
  rbAngularDamping(handle) {
    const ret = wasm.rawrigidbodyset_rbAngularDamping(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {number} factor
  */
  rbSetLinearDamping(handle, factor) {
    wasm.rawrigidbodyset_rbSetLinearDamping(this.__wbg_ptr, handle, factor);
  }
  /**
  * @param {number} handle
  * @param {number} factor
  */
  rbSetAngularDamping(handle, factor) {
    wasm.rawrigidbodyset_rbSetAngularDamping(this.__wbg_ptr, handle, factor);
  }
  /**
  * @param {number} handle
  * @param {boolean} enabled
  */
  rbSetEnabled(handle, enabled) {
    wasm.rawrigidbodyset_rbSetEnabled(this.__wbg_ptr, handle, enabled);
  }
  /**
  * @param {number} handle
  * @returns {boolean}
  */
  rbIsEnabled(handle) {
    const ret = wasm.rawrigidbodyset_rbIsEnabled(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  rbGravityScale(handle) {
    const ret = wasm.rawrigidbodyset_rbGravityScale(this.__wbg_ptr, handle);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {number} factor
  * @param {boolean} wakeUp
  */
  rbSetGravityScale(handle, factor, wakeUp) {
    wasm.rawrigidbodyset_rbSetGravityScale(this.__wbg_ptr, handle, factor, wakeUp);
  }
  /**
  * Resets to zero all user-added forces added to this rigid-body.
  * @param {number} handle
  * @param {boolean} wakeUp
  */
  rbResetForces(handle, wakeUp) {
    wasm.rawrigidbodyset_rbResetForces(this.__wbg_ptr, handle, wakeUp);
  }
  /**
  * Resets to zero all user-added torques added to this rigid-body.
  * @param {number} handle
  * @param {boolean} wakeUp
  */
  rbResetTorques(handle, wakeUp) {
    wasm.rawrigidbodyset_rbResetTorques(this.__wbg_ptr, handle, wakeUp);
  }
  /**
  * Adds a force at the center-of-mass of this rigid-body.
  *
  * # Parameters
  * - `force`: the world-space force to apply on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} force
  * @param {boolean} wakeUp
  */
  rbAddForce(handle, force, wakeUp) {
    _assertClass(force, RawVector);
    wasm.rawrigidbodyset_rbAddForce(this.__wbg_ptr, handle, force.__wbg_ptr, wakeUp);
  }
  /**
  * Applies an impulse at the center-of-mass of this rigid-body.
  *
  * # Parameters
  * - `impulse`: the world-space impulse to apply on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} impulse
  * @param {boolean} wakeUp
  */
  rbApplyImpulse(handle, impulse, wakeUp) {
    _assertClass(impulse, RawVector);
    wasm.rawrigidbodyset_rbApplyImpulse(this.__wbg_ptr, handle, impulse.__wbg_ptr, wakeUp);
  }
  /**
  * Adds a torque at the center-of-mass of this rigid-body.
  *
  * # Parameters
  * - `torque`: the world-space torque to apply on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} torque
  * @param {boolean} wakeUp
  */
  rbAddTorque(handle, torque, wakeUp) {
    _assertClass(torque, RawVector);
    wasm.rawrigidbodyset_rbAddTorque(this.__wbg_ptr, handle, torque.__wbg_ptr, wakeUp);
  }
  /**
  * Applies an impulsive torque at the center-of-mass of this rigid-body.
  *
  * # Parameters
  * - `torque impulse`: the world-space torque impulse to apply on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} torque_impulse
  * @param {boolean} wakeUp
  */
  rbApplyTorqueImpulse(handle, torque_impulse, wakeUp) {
    _assertClass(torque_impulse, RawVector);
    wasm.rawrigidbodyset_rbApplyTorqueImpulse(this.__wbg_ptr, handle, torque_impulse.__wbg_ptr, wakeUp);
  }
  /**
  * Adds a force at the given world-space point of this rigid-body.
  *
  * # Parameters
  * - `force`: the world-space force to apply on the rigid-body.
  * - `point`: the world-space point where the impulse is to be applied on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} force
  * @param {RawVector} point
  * @param {boolean} wakeUp
  */
  rbAddForceAtPoint(handle, force, point, wakeUp) {
    _assertClass(force, RawVector);
    _assertClass(point, RawVector);
    wasm.rawrigidbodyset_rbAddForceAtPoint(this.__wbg_ptr, handle, force.__wbg_ptr, point.__wbg_ptr, wakeUp);
  }
  /**
  * Applies an impulse at the given world-space point of this rigid-body.
  *
  * # Parameters
  * - `impulse`: the world-space impulse to apply on the rigid-body.
  * - `point`: the world-space point where the impulse is to be applied on the rigid-body.
  * - `wakeUp`: should the rigid-body be automatically woken-up?
  * @param {number} handle
  * @param {RawVector} impulse
  * @param {RawVector} point
  * @param {boolean} wakeUp
  */
  rbApplyImpulseAtPoint(handle, impulse, point, wakeUp) {
    _assertClass(impulse, RawVector);
    _assertClass(point, RawVector);
    wasm.rawrigidbodyset_rbApplyImpulseAtPoint(this.__wbg_ptr, handle, impulse.__wbg_ptr, point.__wbg_ptr, wakeUp);
  }
  /**
  * @param {number} handle
  * @returns {number}
  */
  rbAdditionalSolverIterations(handle) {
    const ret = wasm.rawrigidbodyset_rbAdditionalSolverIterations(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * @param {number} handle
  * @param {number} iters
  */
  rbSetAdditionalSolverIterations(handle, iters) {
    wasm.rawrigidbodyset_rbSetAdditionalSolverIterations(this.__wbg_ptr, handle, iters);
  }
  /**
  * An arbitrary user-defined 32-bit integer
  * @param {number} handle
  * @returns {number}
  */
  rbUserData(handle) {
    const ret = wasm.rawrigidbodyset_rbUserData(this.__wbg_ptr, handle);
    return ret >>> 0;
  }
  /**
  * Sets the user-defined 32-bit integer of this rigid-body.
  *
  * # Parameters
  * - `data`: an arbitrary user-defined 32-bit integer.
  * @param {number} handle
  * @param {number} data
  */
  rbSetUserData(handle, data) {
    wasm.rawrigidbodyset_rbSetUserData(this.__wbg_ptr, handle, data);
  }
  /**
  * Retrieves the constant force(s) the user added to this rigid-body.
  * Returns zero if the rigid-body is not dynamic.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbUserForce(handle) {
    const ret = wasm.rawrigidbodyset_rbUserForce(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  * Retrieves the constant torque(s) the user added to this rigid-body.
  * Returns zero if the rigid-body is not dynamic.
  * @param {number} handle
  * @returns {RawVector}
  */
  rbUserTorque(handle) {
    const ret = wasm.rawrigidbodyset_rbUserTorque(this.__wbg_ptr, handle);
    return RawVector.__wrap(ret);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawrigidbodyset_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {boolean} enabled
  * @param {RawVector} translation
  * @param {RawRotation} rotation
  * @param {number} gravityScale
  * @param {number} mass
  * @param {boolean} massOnly
  * @param {RawVector} centerOfMass
  * @param {RawVector} linvel
  * @param {RawVector} angvel
  * @param {RawVector} principalAngularInertia
  * @param {RawRotation} angularInertiaFrame
  * @param {boolean} translationEnabledX
  * @param {boolean} translationEnabledY
  * @param {boolean} translationEnabledZ
  * @param {boolean} rotationEnabledX
  * @param {boolean} rotationEnabledY
  * @param {boolean} rotationEnabledZ
  * @param {number} linearDamping
  * @param {number} angularDamping
  * @param {RawRigidBodyType} rb_type
  * @param {boolean} canSleep
  * @param {boolean} sleeping
  * @param {number} softCcdPrediction
  * @param {boolean} ccdEnabled
  * @param {number} dominanceGroup
  * @param {number} additional_solver_iterations
  * @returns {number}
  */
  createRigidBody(enabled, translation, rotation, gravityScale, mass, massOnly, centerOfMass, linvel, angvel, principalAngularInertia, angularInertiaFrame, translationEnabledX, translationEnabledY, translationEnabledZ, rotationEnabledX, rotationEnabledY, rotationEnabledZ, linearDamping, angularDamping, rb_type, canSleep, sleeping, softCcdPrediction, ccdEnabled, dominanceGroup, additional_solver_iterations) {
    _assertClass(translation, RawVector);
    _assertClass(rotation, RawRotation);
    _assertClass(centerOfMass, RawVector);
    _assertClass(linvel, RawVector);
    _assertClass(angvel, RawVector);
    _assertClass(principalAngularInertia, RawVector);
    _assertClass(angularInertiaFrame, RawRotation);
    const ret = wasm.rawrigidbodyset_createRigidBody(this.__wbg_ptr, enabled, translation.__wbg_ptr, rotation.__wbg_ptr, gravityScale, mass, massOnly, centerOfMass.__wbg_ptr, linvel.__wbg_ptr, angvel.__wbg_ptr, principalAngularInertia.__wbg_ptr, angularInertiaFrame.__wbg_ptr, translationEnabledX, translationEnabledY, translationEnabledZ, rotationEnabledX, rotationEnabledY, rotationEnabledZ, linearDamping, angularDamping, rb_type, canSleep, sleeping, softCcdPrediction, ccdEnabled, dominanceGroup, additional_solver_iterations);
    return ret;
  }
  /**
  * @param {number} handle
  * @param {RawIslandManager} islands
  * @param {RawColliderSet} colliders
  * @param {RawImpulseJointSet} joints
  * @param {RawMultibodyJointSet} articulations
  */
  remove(handle, islands, colliders, joints, articulations) {
    _assertClass(islands, RawIslandManager);
    _assertClass(colliders, RawColliderSet);
    _assertClass(joints, RawImpulseJointSet);
    _assertClass(articulations, RawMultibodyJointSet);
    wasm.rawrigidbodyset_remove(this.__wbg_ptr, handle, islands.__wbg_ptr, colliders.__wbg_ptr, joints.__wbg_ptr, articulations.__wbg_ptr);
  }
  /**
  * The number of rigid-bodies on this set.
  * @returns {number}
  */
  len() {
    const ret = wasm.rawcolliderset_len(this.__wbg_ptr);
    return ret >>> 0;
  }
  /**
  * Checks if a rigid-body with the given integer handle exists.
  * @param {number} handle
  * @returns {boolean}
  */
  contains(handle) {
    const ret = wasm.rawrigidbodyset_contains(this.__wbg_ptr, handle);
    return ret !== 0;
  }
  /**
  * Applies the given JavaScript function to the integer handle of each rigid-body managed by this set.
  *
  * # Parameters
  * - `f(handle)`: the function to apply to the integer handle of each rigid-body managed by this set. Called as `f(collider)`.
  * @param {Function} f
  */
  forEachRigidBodyHandle(f) {
    try {
      wasm.rawrigidbodyset_forEachRigidBodyHandle(this.__wbg_ptr, addBorrowedObject(f));
    } finally {
      heap[stack_pointer++] = void 0;
    }
  }
  /**
  * @param {RawColliderSet} colliders
  */
  propagateModifiedBodyPositionsToColliders(colliders) {
    _assertClass(colliders, RawColliderSet);
    wasm.rawrigidbodyset_propagateModifiedBodyPositionsToColliders(this.__wbg_ptr, colliders.__wbg_ptr);
  }
};
var RawRotationFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrotation_free(ptr >>> 0));
var RawRotation = class _RawRotation {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawRotation.prototype);
    obj.__wbg_ptr = ptr;
    RawRotationFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawRotationFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawrotation_free(ptr);
  }
  /**
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @param {number} w
  */
  constructor(x, y, z, w) {
    const ret = wasm.rawrotation_new(x, y, z, w);
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * The identity quaternion.
  * @returns {RawRotation}
  */
  static identity() {
    const ret = wasm.rawrotation_identity();
    return _RawRotation.__wrap(ret);
  }
  /**
  * The `x` component of this quaternion.
  * @returns {number}
  */
  get x() {
    const ret = wasm.rawrotation_x(this.__wbg_ptr);
    return ret;
  }
  /**
  * The `y` component of this quaternion.
  * @returns {number}
  */
  get y() {
    const ret = wasm.rawintegrationparameters_dt(this.__wbg_ptr);
    return ret;
  }
  /**
  * The `z` component of this quaternion.
  * @returns {number}
  */
  get z() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
  /**
  * The `w` component of this quaternion.
  * @returns {number}
  */
  get w() {
    const ret = wasm.rawrotation_w(this.__wbg_ptr);
    return ret;
  }
};
var RawSdpMatrix3Finalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawsdpmatrix3_free(ptr >>> 0));
var RawSdpMatrix3 = class _RawSdpMatrix3 {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawSdpMatrix3.prototype);
    obj.__wbg_ptr = ptr;
    RawSdpMatrix3Finalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawSdpMatrix3Finalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawsdpmatrix3_free(ptr);
  }
  /**
  * Row major list of the upper-triangular part of the symmetric matrix.
  * @returns {Float32Array}
  */
  elements() {
    const ret = wasm.rawsdpmatrix3_elements(this.__wbg_ptr);
    return takeObject(ret);
  }
};
var RawSerializationPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawserializationpipeline_free(ptr >>> 0));
var RawSerializationPipeline = class {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawSerializationPipelineFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawserializationpipeline_free(ptr);
  }
  /**
  */
  constructor() {
    const ret = wasm.rawserializationpipeline_new();
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * @param {RawVector} gravity
  * @param {RawIntegrationParameters} integrationParameters
  * @param {RawIslandManager} islands
  * @param {RawBroadPhase} broadPhase
  * @param {RawNarrowPhase} narrowPhase
  * @param {RawRigidBodySet} bodies
  * @param {RawColliderSet} colliders
  * @param {RawImpulseJointSet} impulse_joints
  * @param {RawMultibodyJointSet} multibody_joints
  * @returns {Uint8Array | undefined}
  */
  serializeAll(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, impulse_joints, multibody_joints) {
    _assertClass(gravity, RawVector);
    _assertClass(integrationParameters, RawIntegrationParameters);
    _assertClass(islands, RawIslandManager);
    _assertClass(broadPhase, RawBroadPhase);
    _assertClass(narrowPhase, RawNarrowPhase);
    _assertClass(bodies, RawRigidBodySet);
    _assertClass(colliders, RawColliderSet);
    _assertClass(impulse_joints, RawImpulseJointSet);
    _assertClass(multibody_joints, RawMultibodyJointSet);
    const ret = wasm.rawserializationpipeline_serializeAll(this.__wbg_ptr, gravity.__wbg_ptr, integrationParameters.__wbg_ptr, islands.__wbg_ptr, broadPhase.__wbg_ptr, narrowPhase.__wbg_ptr, bodies.__wbg_ptr, colliders.__wbg_ptr, impulse_joints.__wbg_ptr, multibody_joints.__wbg_ptr);
    return takeObject(ret);
  }
  /**
  * @param {Uint8Array} data
  * @returns {RawDeserializedWorld | undefined}
  */
  deserializeAll(data) {
    const ret = wasm.rawserializationpipeline_deserializeAll(this.__wbg_ptr, addHeapObject(data));
    return ret === 0 ? void 0 : RawDeserializedWorld.__wrap(ret);
  }
};
var RawShapeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshape_free(ptr >>> 0));
var RawShape = class _RawShape {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawShape.prototype);
    obj.__wbg_ptr = ptr;
    RawShapeFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawShapeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawshape_free(ptr);
  }
  /**
  * @param {number} hx
  * @param {number} hy
  * @param {number} hz
  * @returns {RawShape}
  */
  static cuboid(hx, hy, hz) {
    const ret = wasm.rawshape_cuboid(hx, hy, hz);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} hx
  * @param {number} hy
  * @param {number} hz
  * @param {number} borderRadius
  * @returns {RawShape}
  */
  static roundCuboid(hx, hy, hz, borderRadius) {
    const ret = wasm.rawshape_roundCuboid(hx, hy, hz, borderRadius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} radius
  * @returns {RawShape}
  */
  static ball(radius) {
    const ret = wasm.rawshape_ball(radius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {RawVector} normal
  * @returns {RawShape}
  */
  static halfspace(normal) {
    _assertClass(normal, RawVector);
    const ret = wasm.rawshape_halfspace(normal.__wbg_ptr);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} halfHeight
  * @param {number} radius
  * @returns {RawShape}
  */
  static capsule(halfHeight, radius) {
    const ret = wasm.rawshape_capsule(halfHeight, radius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} halfHeight
  * @param {number} radius
  * @returns {RawShape}
  */
  static cylinder(halfHeight, radius) {
    const ret = wasm.rawshape_cylinder(halfHeight, radius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} halfHeight
  * @param {number} radius
  * @param {number} borderRadius
  * @returns {RawShape}
  */
  static roundCylinder(halfHeight, radius, borderRadius) {
    const ret = wasm.rawshape_roundCylinder(halfHeight, radius, borderRadius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} halfHeight
  * @param {number} radius
  * @returns {RawShape}
  */
  static cone(halfHeight, radius) {
    const ret = wasm.rawshape_cone(halfHeight, radius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} halfHeight
  * @param {number} radius
  * @param {number} borderRadius
  * @returns {RawShape}
  */
  static roundCone(halfHeight, radius, borderRadius) {
    const ret = wasm.rawshape_roundCone(halfHeight, radius, borderRadius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} vertices
  * @param {Uint32Array} indices
  * @returns {RawShape}
  */
  static polyline(vertices, indices) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_polyline(ptr0, len0, ptr1, len1);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} vertices
  * @param {Uint32Array} indices
  * @param {number} flags
  * @returns {RawShape}
  */
  static trimesh(vertices, indices, flags) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_trimesh(ptr0, len0, ptr1, len1, flags);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {number} nrows
  * @param {number} ncols
  * @param {Float32Array} heights
  * @param {RawVector} scale
  * @param {number} flags
  * @returns {RawShape}
  */
  static heightfield(nrows, ncols, heights, scale, flags) {
    const ptr0 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(scale, RawVector);
    const ret = wasm.rawshape_heightfield(nrows, ncols, ptr0, len0, scale.__wbg_ptr, flags);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {RawVector} p1
  * @param {RawVector} p2
  * @returns {RawShape}
  */
  static segment(p1, p2) {
    _assertClass(p1, RawVector);
    _assertClass(p2, RawVector);
    const ret = wasm.rawshape_segment(p1.__wbg_ptr, p2.__wbg_ptr);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {RawVector} p1
  * @param {RawVector} p2
  * @param {RawVector} p3
  * @returns {RawShape}
  */
  static triangle(p1, p2, p3) {
    _assertClass(p1, RawVector);
    _assertClass(p2, RawVector);
    _assertClass(p3, RawVector);
    const ret = wasm.rawshape_triangle(p1.__wbg_ptr, p2.__wbg_ptr, p3.__wbg_ptr);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {RawVector} p1
  * @param {RawVector} p2
  * @param {RawVector} p3
  * @param {number} borderRadius
  * @returns {RawShape}
  */
  static roundTriangle(p1, p2, p3, borderRadius) {
    _assertClass(p1, RawVector);
    _assertClass(p2, RawVector);
    _assertClass(p3, RawVector);
    const ret = wasm.rawshape_roundTriangle(p1.__wbg_ptr, p2.__wbg_ptr, p3.__wbg_ptr, borderRadius);
    return _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} points
  * @returns {RawShape | undefined}
  */
  static convexHull(points) {
    const ptr0 = passArrayF32ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_convexHull(ptr0, len0);
    return ret === 0 ? void 0 : _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} points
  * @param {number} borderRadius
  * @returns {RawShape | undefined}
  */
  static roundConvexHull(points, borderRadius) {
    const ptr0 = passArrayF32ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_roundConvexHull(ptr0, len0, borderRadius);
    return ret === 0 ? void 0 : _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} vertices
  * @param {Uint32Array} indices
  * @returns {RawShape | undefined}
  */
  static convexMesh(vertices, indices) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_convexMesh(ptr0, len0, ptr1, len1);
    return ret === 0 ? void 0 : _RawShape.__wrap(ret);
  }
  /**
  * @param {Float32Array} vertices
  * @param {Uint32Array} indices
  * @param {number} borderRadius
  * @returns {RawShape | undefined}
  */
  static roundConvexMesh(vertices, indices, borderRadius) {
    const ptr0 = passArrayF32ToWasm0(vertices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rawshape_roundConvexMesh(ptr0, len0, ptr1, len1, borderRadius);
    return ret === 0 ? void 0 : _RawShape.__wrap(ret);
  }
  /**
  * @param {RawVector} shapePos1
  * @param {RawRotation} shapeRot1
  * @param {RawVector} shapeVel1
  * @param {RawShape} shape2
  * @param {RawVector} shapePos2
  * @param {RawRotation} shapeRot2
  * @param {RawVector} shapeVel2
  * @param {number} target_distance
  * @param {number} maxToi
  * @param {boolean} stop_at_penetration
  * @returns {RawShapeCastHit | undefined}
  */
  castShape(shapePos1, shapeRot1, shapeVel1, shape2, shapePos2, shapeRot2, shapeVel2, target_distance, maxToi, stop_at_penetration) {
    _assertClass(shapePos1, RawVector);
    _assertClass(shapeRot1, RawRotation);
    _assertClass(shapeVel1, RawVector);
    _assertClass(shape2, _RawShape);
    _assertClass(shapePos2, RawVector);
    _assertClass(shapeRot2, RawRotation);
    _assertClass(shapeVel2, RawVector);
    const ret = wasm.rawshape_castShape(this.__wbg_ptr, shapePos1.__wbg_ptr, shapeRot1.__wbg_ptr, shapeVel1.__wbg_ptr, shape2.__wbg_ptr, shapePos2.__wbg_ptr, shapeRot2.__wbg_ptr, shapeVel2.__wbg_ptr, target_distance, maxToi, stop_at_penetration);
    return ret === 0 ? void 0 : RawShapeCastHit.__wrap(ret);
  }
  /**
  * @param {RawVector} shapePos1
  * @param {RawRotation} shapeRot1
  * @param {RawShape} shape2
  * @param {RawVector} shapePos2
  * @param {RawRotation} shapeRot2
  * @returns {boolean}
  */
  intersectsShape(shapePos1, shapeRot1, shape2, shapePos2, shapeRot2) {
    _assertClass(shapePos1, RawVector);
    _assertClass(shapeRot1, RawRotation);
    _assertClass(shape2, _RawShape);
    _assertClass(shapePos2, RawVector);
    _assertClass(shapeRot2, RawRotation);
    const ret = wasm.rawshape_intersectsShape(this.__wbg_ptr, shapePos1.__wbg_ptr, shapeRot1.__wbg_ptr, shape2.__wbg_ptr, shapePos2.__wbg_ptr, shapeRot2.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {RawVector} shapePos1
  * @param {RawRotation} shapeRot1
  * @param {RawShape} shape2
  * @param {RawVector} shapePos2
  * @param {RawRotation} shapeRot2
  * @param {number} prediction
  * @returns {RawShapeContact | undefined}
  */
  contactShape(shapePos1, shapeRot1, shape2, shapePos2, shapeRot2, prediction) {
    _assertClass(shapePos1, RawVector);
    _assertClass(shapeRot1, RawRotation);
    _assertClass(shape2, _RawShape);
    _assertClass(shapePos2, RawVector);
    _assertClass(shapeRot2, RawRotation);
    const ret = wasm.rawshape_contactShape(this.__wbg_ptr, shapePos1.__wbg_ptr, shapeRot1.__wbg_ptr, shape2.__wbg_ptr, shapePos2.__wbg_ptr, shapeRot2.__wbg_ptr, prediction);
    return ret === 0 ? void 0 : RawShapeContact.__wrap(ret);
  }
  /**
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} point
  * @returns {boolean}
  */
  containsPoint(shapePos, shapeRot, point) {
    _assertClass(shapePos, RawVector);
    _assertClass(shapeRot, RawRotation);
    _assertClass(point, RawVector);
    const ret = wasm.rawshape_containsPoint(this.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, point.__wbg_ptr);
    return ret !== 0;
  }
  /**
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} point
  * @param {boolean} solid
  * @returns {RawPointProjection}
  */
  projectPoint(shapePos, shapeRot, point, solid) {
    _assertClass(shapePos, RawVector);
    _assertClass(shapeRot, RawRotation);
    _assertClass(point, RawVector);
    const ret = wasm.rawshape_projectPoint(this.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, point.__wbg_ptr, solid);
    return RawPointProjection.__wrap(ret);
  }
  /**
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @returns {boolean}
  */
  intersectsRay(shapePos, shapeRot, rayOrig, rayDir, maxToi) {
    _assertClass(shapePos, RawVector);
    _assertClass(shapeRot, RawRotation);
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawshape_intersectsRay(this.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi);
    return ret !== 0;
  }
  /**
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @returns {number}
  */
  castRay(shapePos, shapeRot, rayOrig, rayDir, maxToi, solid) {
    _assertClass(shapePos, RawVector);
    _assertClass(shapeRot, RawRotation);
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawshape_castRay(this.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid);
    return ret;
  }
  /**
  * @param {RawVector} shapePos
  * @param {RawRotation} shapeRot
  * @param {RawVector} rayOrig
  * @param {RawVector} rayDir
  * @param {number} maxToi
  * @param {boolean} solid
  * @returns {RawRayIntersection | undefined}
  */
  castRayAndGetNormal(shapePos, shapeRot, rayOrig, rayDir, maxToi, solid) {
    _assertClass(shapePos, RawVector);
    _assertClass(shapeRot, RawRotation);
    _assertClass(rayOrig, RawVector);
    _assertClass(rayDir, RawVector);
    const ret = wasm.rawshape_castRayAndGetNormal(this.__wbg_ptr, shapePos.__wbg_ptr, shapeRot.__wbg_ptr, rayOrig.__wbg_ptr, rayDir.__wbg_ptr, maxToi, solid);
    return ret === 0 ? void 0 : RawRayIntersection.__wrap(ret);
  }
};
var RawShapeCastHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshapecasthit_free(ptr >>> 0));
var RawShapeCastHit = class _RawShapeCastHit {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawShapeCastHit.prototype);
    obj.__wbg_ptr = ptr;
    RawShapeCastHitFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawShapeCastHitFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawshapecasthit_free(ptr);
  }
  /**
  * @returns {number}
  */
  time_of_impact() {
    const ret = wasm.rawrotation_x(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  witness1() {
    const ret = wasm.rawshapecasthit_witness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  witness2() {
    const ret = wasm.rawcontactforceevent_total_force(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal1() {
    const ret = wasm.rawshapecasthit_normal1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal2() {
    const ret = wasm.rawshapecasthit_normal2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
};
var RawShapeContactFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshapecontact_free(ptr >>> 0));
var RawShapeContact = class _RawShapeContact {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawShapeContact.prototype);
    obj.__wbg_ptr = ptr;
    RawShapeContactFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawShapeContactFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawshapecontact_free(ptr);
  }
  /**
  * @returns {number}
  */
  distance() {
    const ret = wasm.rawkinematiccharactercontroller_maxSlopeClimbAngle(this.__wbg_ptr);
    return ret;
  }
  /**
  * @returns {RawVector}
  */
  point1() {
    const ret = wasm.rawpointprojection_point(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  point2() {
    const ret = wasm.rawcollidershapecasthit_witness1(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal1() {
    const ret = wasm.rawcollidershapecasthit_witness2(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
  /**
  * @returns {RawVector}
  */
  normal2() {
    const ret = wasm.rawcharactercollision_translationDeltaApplied(this.__wbg_ptr);
    return RawVector.__wrap(ret);
  }
};
var RawVectorFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_rawvector_free(ptr >>> 0));
var RawVector = class _RawVector {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(_RawVector.prototype);
    obj.__wbg_ptr = ptr;
    RawVectorFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    RawVectorFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_rawvector_free(ptr);
  }
  /**
  * Creates a new vector filled with zeros.
  * @returns {RawVector}
  */
  static zero() {
    const ret = wasm.rawvector_zero();
    return _RawVector.__wrap(ret);
  }
  /**
  * Creates a new 3D vector from its two components.
  *
  * # Parameters
  * - `x`: the `x` component of this 3D vector.
  * - `y`: the `y` component of this 3D vector.
  * - `z`: the `z` component of this 3D vector.
  * @param {number} x
  * @param {number} y
  * @param {number} z
  */
  constructor(x, y, z) {
    const ret = wasm.rawvector_new(x, y, z);
    this.__wbg_ptr = ret >>> 0;
    return this;
  }
  /**
  * The `x` component of this vector.
  * @returns {number}
  */
  get x() {
    const ret = wasm.rawrotation_x(this.__wbg_ptr);
    return ret;
  }
  /**
  * Sets the `x` component of this vector.
  * @param {number} x
  */
  set x(x) {
    wasm.rawvector_set_x(this.__wbg_ptr, x);
  }
  /**
  * The `y` component of this vector.
  * @returns {number}
  */
  get y() {
    const ret = wasm.rawintegrationparameters_dt(this.__wbg_ptr);
    return ret;
  }
  /**
  * Sets the `y` component of this vector.
  * @param {number} y
  */
  set y(y) {
    wasm.rawintegrationparameters_set_dt(this.__wbg_ptr, y);
  }
  /**
  * The `z` component of this vector.
  * @returns {number}
  */
  get z() {
    const ret = wasm.rawcollidershapecasthit_time_of_impact(this.__wbg_ptr);
    return ret;
  }
  /**
  * Sets the `z` component of this vector.
  * @param {number} z
  */
  set z(z) {
    wasm.rawvector_set_z(this.__wbg_ptr, z);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{x, y, z}`.
  *
  * This will effectively return a copy of `this`. This method exist for completeness with the
  * other swizzling functions.
  * @returns {RawVector}
  */
  xyz() {
    const ret = wasm.rawvector_xyz(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{y, x, z}`.
  * @returns {RawVector}
  */
  yxz() {
    const ret = wasm.rawvector_yxz(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{z, x, y}`.
  * @returns {RawVector}
  */
  zxy() {
    const ret = wasm.rawvector_zxy(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{x, z, y}`.
  * @returns {RawVector}
  */
  xzy() {
    const ret = wasm.rawvector_xzy(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{y, z, x}`.
  * @returns {RawVector}
  */
  yzx() {
    const ret = wasm.rawvector_yzx(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
  /**
  * Create a new 3D vector from this vector with its components rearranged as `{z, y, x}`.
  * @returns {RawVector}
  */
  zyx() {
    const ret = wasm.rawvector_zyx(this.__wbg_ptr);
    return _RawVector.__wrap(ret);
  }
};
function __wbindgen_number_new(arg0) {
  const ret = arg0;
  return addHeapObject(ret);
}
function __wbindgen_boolean_get(arg0) {
  const v = getObject(arg0);
  const ret = typeof v === "boolean" ? v ? 1 : 0 : 2;
  return ret;
}
function __wbindgen_object_drop_ref(arg0) {
  takeObject(arg0);
}
function __wbindgen_number_get(arg0, arg1) {
  const obj = getObject(arg1);
  const ret = typeof obj === "number" ? obj : void 0;
  getFloat64Memory0()[arg0 / 8 + 1] = isLikeNone(ret) ? 0 : ret;
  getInt32Memory0()[arg0 / 4 + 0] = !isLikeNone(ret);
}
function __wbindgen_is_function(arg0) {
  const ret = typeof getObject(arg0) === "function";
  return ret;
}
function __wbg_rawraycolliderintersection_new(arg0) {
  const ret = RawRayColliderIntersection.__wrap(arg0);
  return addHeapObject(ret);
}
function __wbg_rawcontactforceevent_new(arg0) {
  const ret = RawContactForceEvent.__wrap(arg0);
  return addHeapObject(ret);
}
function __wbg_call_b3ca7c6051f9bec1() {
  return handleError(function(arg0, arg1, arg2) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
  }, arguments);
}
function __wbg_call_8e7cb608789c2528() {
  return handleError(function(arg0, arg1, arg2, arg3) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3));
    return addHeapObject(ret);
  }, arguments);
}
function __wbg_call_938992c832f74314() {
  return handleError(function(arg0, arg1, arg2, arg3, arg4) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3), getObject(arg4));
    return addHeapObject(ret);
  }, arguments);
}
function __wbg_bind_4d857b598695205e(arg0, arg1, arg2, arg3) {
  const ret = getObject(arg0).bind(getObject(arg1), getObject(arg2), getObject(arg3));
  return addHeapObject(ret);
}
function __wbg_buffer_12d079cc21e14bdb(arg0) {
  const ret = getObject(arg0).buffer;
  return addHeapObject(ret);
}
function __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb(arg0, arg1, arg2) {
  const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
  return addHeapObject(ret);
}
function __wbg_new_63b92bc8671ed464(arg0) {
  const ret = new Uint8Array(getObject(arg0));
  return addHeapObject(ret);
}
function __wbg_set_a47bac70306a19a7(arg0, arg1, arg2) {
  getObject(arg0).set(getObject(arg1), arg2 >>> 0);
}
function __wbg_length_c20a40f15020d68a(arg0) {
  const ret = getObject(arg0).length;
  return ret;
}
function __wbg_newwithbyteoffsetandlength_4a659d079a1650e0(arg0, arg1, arg2) {
  const ret = new Float32Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
  return addHeapObject(ret);
}
function __wbg_set_bd975934d1b1fddb(arg0, arg1, arg2) {
  getObject(arg0).set(getObject(arg1), arg2 >>> 0);
}
function __wbg_length_d25bbcbc3367f684(arg0) {
  const ret = getObject(arg0).length;
  return ret;
}
function __wbg_newwithlength_1e8b839a06de01c5(arg0) {
  const ret = new Float32Array(arg0 >>> 0);
  return addHeapObject(ret);
}
function __wbindgen_throw(arg0, arg1) {
  throw new Error(getStringFromWasm0(arg0, arg1));
}
function __wbindgen_memory() {
  const ret = wasm.memory;
  return addHeapObject(ret);
}

// tools/_geo.ts
import fs from "node:fs";
import { createRequire } from "node:module";

// src/data/parts.json
var parts_default = {
  generator: "tools/build-parts.py",
  source: "C:\\Users\\22641\\Desktop\\\u6E38\u620F\u7D20\u6750\\ui\u9875\u9762\\\u6D77\u732B_\u62A0\u56FE",
  canvas: {
    w: 1568,
    h: 2944
  },
  scale: 0.5,
  extent: {
    x0: 13,
    y0: 92,
    x1: 1552,
    y1: 2899,
    w: 1539,
    h: 2807
  },
  parts: [
    {
      key: "shin_l",
      label: "\u5DE6\u5C0F\u817F",
      bone: "shinL",
      z: 10,
      file: "parts/shin_l.webp",
      w: 186,
      h: 408,
      bytes: 11458,
      cx: 461.5,
      cy: 2484.5,
      bw: 373,
      bh: 817
    },
    {
      key: "shin_r",
      label: "\u53F3\u5C0F\u817F",
      bone: "shinR",
      z: 11,
      file: "parts/shin_r.webp",
      w: 175,
      h: 437,
      bytes: 12302,
      cx: 1075,
      cy: 2462,
      bw: 350,
      bh: 874
    },
    {
      key: "thigh_l",
      label: "\u5DE6\u5927\u817F",
      bone: "thighL",
      z: 20,
      file: "parts/thigh_l.webp",
      w: 178,
      h: 334,
      bytes: 8428,
      cx: 620.5,
      cy: 1884.5,
      bw: 357,
      bh: 669
    },
    {
      key: "thigh_r",
      label: "\u53F3\u5927\u817F",
      bone: "thighR",
      z: 21,
      file: "parts/thigh_r.webp",
      w: 187,
      h: 346,
      bytes: 8960,
      cx: 931,
      cy: 1894.5,
      bw: 374,
      bh: 691
    },
    {
      key: "torso",
      label: "\u8EAB\u4F53",
      bone: "torso",
      z: 30,
      file: "parts/torso.webp",
      w: 353,
      h: 628,
      bytes: 30216,
      cx: 772,
      cy: 1140.5,
      bw: 706,
      bh: 1255
    },
    {
      key: "arm_l",
      label: "\u5DE6\u81C2",
      bone: "armL",
      z: 40,
      file: "parts/arm_l.webp",
      w: 124,
      h: 298,
      bytes: 9268,
      cx: 399.5,
      cy: 922.5,
      bw: 247,
      bh: 595
    },
    {
      key: "arm_r",
      label: "\u53F3\u81C2",
      bone: "armR",
      z: 41,
      file: "parts/arm_r.webp",
      w: 112,
      h: 246,
      bytes: 7932,
      cx: 1127.5,
      cy: 936,
      bw: 223,
      bh: 492
    },
    {
      key: "hand_l",
      label: "\u5DE6\u624B",
      bone: "handL",
      z: 50,
      file: "parts/hand_l.webp",
      w: 238,
      h: 328,
      bytes: 15240,
      cx: 251.5,
      cy: 1370,
      bw: 477,
      bh: 656
    },
    {
      key: "hand_r",
      label: "\u53F3\u624B",
      bone: "handR",
      z: 51,
      file: "parts/hand_r.webp",
      w: 234,
      h: 308,
      bytes: 14706,
      cx: 1317.5,
      cy: 1392,
      bw: 469,
      bh: 616
    },
    {
      key: "head",
      label: "\u5934",
      bone: "head",
      z: 60,
      file: "parts/head.webp",
      w: 179,
      h: 320,
      bytes: 13014,
      cx: 792,
      cy: 412,
      bw: 358,
      bh: 640
    }
  ],
  joints: [
    {
      name: "neck",
      parent: "torso",
      child: "head",
      x: 792,
      y: 622.5,
      limitDeg: [
        -35,
        45
      ]
    },
    {
      name: "shoulder_l",
      parent: "torso",
      child: "arm_l",
      x: 471,
      y: 922.5,
      limitDeg: [
        -95,
        80
      ]
    },
    {
      name: "shoulder_r",
      parent: "torso",
      child: "arm_r",
      x: 1070.5,
      y: 936,
      limitDeg: [
        -95,
        80
      ]
    },
    {
      name: "elbow_l",
      parent: "arm_l",
      child: "hand_l",
      x: 383,
      y: 1131,
      limitDeg: [
        -120,
        10
      ]
    },
    {
      name: "elbow_r",
      parent: "arm_r",
      child: "hand_r",
      x: 1161,
      y: 1133,
      limitDeg: [
        -120,
        10
      ]
    },
    {
      name: "hip_l",
      parent: "torso",
      child: "thigh_l",
      x: 620.5,
      y: 1659,
      limitDeg: [
        -80,
        60
      ]
    },
    {
      name: "hip_r",
      parent: "torso",
      child: "thigh_r",
      x: 931,
      y: 1658.5,
      limitDeg: [
        -80,
        60
      ]
    },
    {
      name: "knee_l",
      parent: "thigh_l",
      child: "shin_l",
      x: 545,
      y: 2147.5,
      limitDeg: [
        -145,
        2
      ]
    },
    {
      name: "knee_r",
      parent: "thigh_r",
      child: "shin_r",
      x: 1009,
      y: 2132.5,
      limitDeg: [
        -145,
        2
      ]
    }
  ],
  sole: {
    len: 343.14,
    thick: 81.7,
    massPercent: 1.45
  },
  bytesTotal: 131524
};

// src/data/limbAxes.json
var limbAxes_default = {
  _comment: "\u80A2\u4F53\u4E2D\u8F74 + \u5173\u8282\u951A\u70B9 + \u722A\u533A\u5B9E\u6D4B\uFF08\u753B\u5E03 px\uFF0C\u6E90\u56FE\u5750\u6807\uFF09\u3002tools/measure-limb-axes.py \u751F\u6210\u3002\u951A\u70B9\u5DF2\u4FDD\u8BC1\u843D\u5728\u7236/\u5B50\u8D34\u56FE alpha \u5185\u90E8\uFF08margin \u5B57\u6BB5\uFF09\u21D2 \u5173\u8282\u8FDE\u5F97\u4E0A\uFF1Bskeleton.ts \u6D88\u8D39 anchors/paw\uFF1Bverify-core \u9489\u4F4F margin \u2265 0\u3002",
  source: "C:\\Users\\22641\\Desktop\\\u6E38\u620F\u7D20\u6750\\ui\u9875\u9762\\\u6D77\u732B_\u62A0\u56FE",
  scale: 0.5,
  axes: {
    arm_l: {
      k: -0.08834,
      b: 514.62,
      rms: 11.13,
      tiltDeg: -5.05,
      proxTip: [
        456.5,
        658
      ],
      distTip: [
        408.7,
        1199.5
      ],
      lenPx: 541.5
    },
    arm_r: {
      k: 0.08834,
      b: 1050.38,
      rms: 6.92,
      tiltDeg: 5.05,
      proxTip: [
        1108.5,
        658
      ],
      distTip: [
        1156.3,
        1199.5
      ],
      lenPx: 541.5
    },
    hand_l: {
      k: -0.60768,
      b: 1089.66,
      rms: 24.08,
      tiltDeg: -31.29,
      proxTip: [
        443.4,
        1063.5
      ],
      distTip: [
        57.8,
        1698
      ],
      lenPx: 634.5
    },
    hand_r: {
      k: 0.60768,
      b: 475.34,
      rms: 23.22,
      tiltDeg: 31.29,
      proxTip: [
        1121.6,
        1063.5
      ],
      distTip: [
        1507.2,
        1698
      ],
      lenPx: 634.5
    },
    thigh_l: {
      k: -0.14031,
      b: 862.02,
      rms: 4.7,
      tiltDeg: -7.99,
      proxTip: [
        644.6,
        1549.5
      ],
      distTip: [
        549.3,
        2228.5
      ],
      lenPx: 679
    },
    thigh_r: {
      k: 0.14031,
      b: 702.98,
      rms: 11.02,
      tiltDeg: 7.99,
      proxTip: [
        920.4,
        1549.5
      ],
      distTip: [
        1015.7,
        2228.5
      ],
      lenPx: 679
    },
    shin_l: {
      k: -0,
      b: 527.46,
      rms: 10.05,
      tiltDeg: -0,
      proxTip: [
        527.5,
        2051.5
      ],
      distTip: [
        527.5,
        2792
      ],
      lenPx: 740.5
    },
    shin_r: {
      k: 0,
      b: 1037.54,
      rms: 9.06,
      tiltDeg: 0,
      proxTip: [
        1037.5,
        2051.5
      ],
      distTip: [
        1037.5,
        2792
      ],
      lenPx: 740.5
    },
    torso: {
      k: -0.0135,
      b: 787.96,
      rms: 6.73,
      tiltDeg: -0.77,
      proxTip: [
        783.5,
        513
      ],
      distTip: [
        874.5,
        1767
      ],
      lenPx: 1254
    },
    head: {
      k: -0.01059,
      b: 791.21,
      rms: 4.7,
      tiltDeg: -0.61,
      proxTip: [
        796,
        92
      ],
      distTip: [
        775,
        731
      ],
      lenPx: 639
    }
  },
  anchors: {
    neck: [
      792,
      622.5
    ],
    shoulder_l: [
      479,
      703.5
    ],
    shoulder_r: [
      1086,
      703.5
    ],
    elbow_l: [
      416.9,
      1107
    ],
    elbow_r: [
      1148.1,
      1107
    ],
    hip_l: [
      587.5,
      1574.5
    ],
    hip_r: [
      977.5,
      1574.5
    ],
    knee_l: [
      527.5,
      2206
    ],
    knee_r: [
      1037.5,
      2206
    ],
    foot_l: [
      454.5,
      2792
    ],
    foot_r: [
      1110.5,
      2792
    ]
  },
  margin: {
    neck: 99,
    shoulder_l: 25,
    shoulder_r: 25,
    elbow_l: 32,
    elbow_r: 18,
    hip_l: 25,
    hip_r: 25,
    knee_l: 20,
    knee_r: 20
  },
  paw: {
    l: {
      yWide: 2792,
      yLow: 2895,
      centerX: 454.5,
      drawnAxisXAtSole: 488.1,
      shaftTiltDeg: -5.54,
      lateralHalf: 159,
      pawHeightPx: 103,
      slopeDeg: -0.82
    },
    r: {
      yWide: 2792,
      yLow: 2895,
      centerX: 1110.5,
      drawnAxisXAtSole: 1076.9,
      shaftTiltDeg: 4.88,
      lateralHalf: 159,
      pawHeightPx: 103,
      slopeDeg: 0.82
    }
  },
  anchorsNote: "foot_l/foot_r = \u8E1D\u951A\u70B9\uFF1Ay \u53D6 paw.yWide\uFF08\u9774\u5B50\u9876\u7AEF\uFF0C\u5B9E\u6D4B 2792\uFF09\uFF0Cx \u53D6 paw.centerX\uFF08\u5B9E\u6D4B\u9774\u5FC3\uFF09\u30022026-10-01 \u52A0\u8E1D\u5173\u8282\u65F6\u52A0\u5165\u3002"
};

// src/core/partsMeta.ts
var ANKLE_JOINTS = [
  { name: "foot_l", parent: "shin_l", child: "foot_l", x: 454.5, y: 2792, limitDeg: [-10, 18] },
  { name: "foot_r", parent: "shin_r", child: "foot_r", x: 1110.5, y: 2792, limitDeg: [-10, 18] }
];
var meta = parts_default;
if (!meta.joints.some((j) => j.name === "foot_l")) meta.joints.push(...ANKLE_JOINTS);
var META = meta;
var PART_BY_KEY = new Map(
  META.parts.map((p) => [p.key, p])
);
var LIMB_AXES = limbAxes_default;

// src/core/skeleton.ts
function restQuatOf(tiltRad, yawRad) {
  const ht = tiltRad / 2, hy = yawRad / 2;
  return [
    Math.cos(hy) * Math.sin(ht),
    Math.sin(hy) * Math.cos(ht),
    -Math.sin(hy) * Math.sin(ht),
    Math.cos(hy) * Math.cos(ht)
  ];
}
function restVisualQuatOf(tiltRad) {
  return restQuatOf(tiltRad, 0);
}
function invQuatOf(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function quatToRotVec(q) {
  const w = q[3] > 1 ? 1 : q[3] < -1 ? -1 : q[3];
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (Math.abs(s) < 1e-7) return [0, 0, 0];
  const ang = 2 * half;
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  return [q[0] * k, q[1] * k, q[2] * k];
}
function quatRel(a, b) {
  const cx = -a[0], cy = -a[1], cz = -a[2], cw = a[3];
  return [
    cw * b[0] + cx * b[3] + cy * b[2] - cz * b[1],
    cw * b[1] - cx * b[2] + cy * b[3] + cz * b[0],
    cw * b[2] + cx * b[1] - cy * b[0] + cz * b[3],
    cw * b[3] - cx * b[0] - cy * b[1] - cz * b[2]
  ];
}
function rotVecByQuat(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx)
  ];
}
var DEFAULT_CONFIG = {
  height: 1.8,
  mass: 70,
  // ★ 2D 时代用 0.5 是为了在**同一个平面内**减少双腿互穿；3D 之后双腿分开在 Z 上，
  //   再并拢反而让两个大腿胶囊（半径 6.9cm、间距 10cm）重叠。取 1.0 = 素材原样的
  //   自然站姿宽度（大腿中心间距 ≈ 0.20m）。
  stance: 1,
  limbRadiusScale: 0.6,
  // 4 段 ⇒ 骨盆 + 3 节脊椎（腰-胸-颈），脊柱关节 3 个，转动自由度 36。
  // 段数不宜再多：每段都要有独立质量与惯量，切太细 ES 的搜索空间会爆炸（且小段的
  // 惯量趋近于 0，正是 probe-motor 里那种"数值爆炸"的温床）。
  spineSegments: 4,
  soleFootScale: 1,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25,
  // 踝：低头 25°（蹬地/尖脚）… 勾脚 20°（脚跟先着地）。保守取值，避免刚体互穿。
  anklePitchDeg: [0, 0],
  ankleRollDeg: 0,
  ankleTorque: 45,
  footUvWarpDeg: 0,
  ankleEnabled: false
};
var SEGMENTS = [
  { key: "head", bone: "head", label: "\u5934", massPct: 8.1, comRatio: 0.495, gyrationRatio: 0.495, proximal: "bottom" },
  { key: "torso", bone: "torso", label: "\u8EAF\u5E72", massPct: 49.7, comRatio: 0.495, gyrationRatio: 0.406, proximal: "bottom" },
  { key: "arm_l", bone: "armL", label: "\u5DE6\u4E0A\u81C2", massPct: 2.8, comRatio: 0.436, gyrationRatio: 0.322, proximal: "top" },
  { key: "arm_r", bone: "armR", label: "\u53F3\u4E0A\u81C2", massPct: 2.8, comRatio: 0.436, gyrationRatio: 0.322, proximal: "top" },
  { key: "hand_l", bone: "handL", label: "\u5DE6\u524D\u81C2", massPct: 2.2, comRatio: 0.682, gyrationRatio: 0.468, proximal: "top" },
  { key: "hand_r", bone: "handR", label: "\u53F3\u524D\u81C2", massPct: 2.2, comRatio: 0.682, gyrationRatio: 0.468, proximal: "top" },
  { key: "thigh_l", bone: "thighL", label: "\u5DE6\u5927\u817F", massPct: 10, comRatio: 0.433, gyrationRatio: 0.323, proximal: "top", leg: true },
  { key: "thigh_r", bone: "thighR", label: "\u53F3\u5927\u817F", massPct: 10, comRatio: 0.433, gyrationRatio: 0.323, proximal: "top", leg: true },
  { key: "shin_l", bone: "shinL", label: "\u5DE6\u5C0F\u817F", massPct: 6.1, comRatio: 0.433, gyrationRatio: 0.302, proximal: "top", leg: true, soleMassPct: 1.45 },
  { key: "shin_r", bone: "shinR", label: "\u53F3\u5C0F\u817F", massPct: 6.1, comRatio: 0.433, gyrationRatio: 0.302, proximal: "top", leg: true, soleMassPct: 1.45 }
];
var JOINT_ORDER = [
  "neck",
  "shoulder_l",
  "shoulder_r",
  "elbow_l",
  "elbow_r",
  "hip_l",
  "hip_r",
  "knee_l",
  "knee_r",
  // ★ 踝（2026-10-01 新增）：脚掌是独立刚体，这两项是它的俯仰/内外翻。
  //   放在最后 ⇒ 已有的 0~7 号马达索引不变（旧基因组的权重仍对得上前 8 个关节）。
  "foot_l",
  "foot_r"
];
function anchorPx(name, jm) {
  const a = LIMB_AXES.anchors[name];
  return a ? [a[0], a[1]] : [jm.x, jm.y];
}
var JOINT_MAX_TORQUE = {
  neck: 100,
  shoulder_l: 100,
  shoulder_r: 100,
  elbow_l: 40,
  elbow_r: 40,
  hip_l: 200,
  hip_r: 200,
  knee_l: 150,
  knee_r: 150,
  // ★ 踝：比膝小一个量级（踝在人类身上本来就只有膝的 1/5~1/4 力矩），
  //   45 N·m 足够做"勾脚/尖脚"，太大反而会让脚像弹簧一样抽。
  foot_l: 45,
  foot_r: 45
};
var TORQUE_AXIS_FACTOR = [0.6, 0.35, 1];
var JOINT_LIMITS_XY_DEG = {
  neck: [30, 70],
  shoulder_l: [75, 65],
  shoulder_r: [75, 65],
  elbow_l: [14, 16],
  elbow_r: [14, 16],
  hip_l: [45, 40],
  hip_r: [45, 40],
  knee_l: [6, 8],
  knee_r: [6, 8],
  // 踝：X/Y（外展·内外翻）只给 ±8°，踝的侧向自由度不是走路的主自由度，
  //   放开会让脚掌乱翻、把支撑面搞丢。
  foot_l: [8, 6],
  foot_r: [8, 6]
};
var DEG = Math.PI / 180;
function capsuleFromBox(w, h, radiusScale) {
  const length = Math.max(w, h);
  const radius = Math.min(Math.min(w, h) / 2 * radiusScale, length / 2 * 0.92);
  return { length, radius, halfHeight: Math.max(0, length / 2 - radius) };
}
function comOffset(length, comRatio, proximal) {
  return proximal === "top" ? length * (0.5 - comRatio) : length * (comRatio - 0.5);
}
function buildSkeleton(cfg = DEFAULT_CONFIG) {
  const { extent } = META;
  const px2m = cfg.height / extent.h;
  const centerPx = (extent.x0 + extent.x1) / 2;
  const groundPx = extent.y1;
  const mapZ = (px, applyStance) => -(px - centerPx) * px2m * (applyStance ? cfg.stance : 1);
  const mapY = (px) => (groundPx - px) * px2m;
  const legKeys = new Set(SEGMENTS.filter((s) => s.leg).map((s) => s.key));
  const K = Math.max(1, Math.floor(cfg.spineSegments));
  const CHEST = K > 1 ? `spine${K}` : "torso";
  const segKey = (s) => s === 0 ? "torso" : `spine${s + 1}`;
  let byKeyRef = null;
  const attachTo = (parentKey, wy) => {
    if (parentKey !== "torso" || K <= 1 || !byKeyRef) return parentKey;
    let best = 0, bestD = Infinity;
    for (let s = 0; s < K; s++) {
      const b = byKeyRef.get(segKey(s));
      if (!b) continue;
      const d = Math.abs(b.cy - wy);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return segKey(best);
  };
  const soleHalfLen = META.sole.len * px2m / 2;
  const soleHalfThick = META.sole.thick * px2m / 2;
  const PIVOT_PAD = 0.015;
  const TILTED = /* @__PURE__ */ new Set(["arm_l", "arm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "shin_l", "shin_r"]);
  const restTiltOf = (key, leg) => {
    if (!TILTED.has(key)) return 0;
    if (key === "shin_l" || key === "shin_r") return 0;
    const ax = LIMB_AXES.axes[key];
    if (!ax) return 0;
    return Math.atan(ax.k * (leg ? cfg.stance : 1));
  };
  const restYawOf = (key) => {
    if (key !== "shin_l" && key !== "shin_r" && key !== "foot_l" && key !== "foot_r") return 0;
    const s = cfg.footSplayDeg * DEG;
    return key === "shin_l" || key === "foot_l" ? -s : s;
  };
  const bodies = [];
  for (const spec of SEGMENTS) {
    const part = PART_BY_KEY.get(spec.key);
    if (!part) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u7EC4\u4EF6 ${spec.key}`);
    const { length: boxLen, radius, halfHeight: boxHalf } = capsuleFromBox(
      part.bw * px2m,
      part.bh * px2m,
      cfg.limbRadiusScale
    );
    const ax = LIMB_AXES.axes[spec.key];
    let length = boxLen;
    let halfHeight = boxHalf;
    if (ax && TILTED.has(spec.key)) {
      length = Math.max(boxLen, ax.lenPx * px2m) + 2 * PIVOT_PAD;
      halfHeight = Math.max(1e-3, length / 2 - radius);
    }
    const tilt = restTiltOf(spec.key, !!spec.leg);
    const yaw = restYawOf(spec.key);
    const qRestInv = invQuatOf(restQuatOf(tilt, yaw));
    const qVisInv = invQuatOf(restVisualQuatOf(tilt));
    let centerY = mapY(part.cy);
    let centerZ = mapZ(part.cx, !!spec.leg);
    if (ax && TILTED.has(spec.key)) {
      const midY = (ax.proxTip[1] + ax.distTip[1]) / 2;
      const midX = (ax.proxTip[0] + ax.distTip[0]) / 2;
      centerY = mapY(midY);
      centerZ = mapZ(midX, !!spec.leg);
    }
    let footAnkle = null;
    if (cfg.ankleEnabled && spec.leg && (spec.soleMassPct ?? 0) > 0) {
      const side2 = spec.key === "shin_l" ? "l" : "r";
      const ak = LIMB_AXES.anchors?.[`foot_${side2}`];
      const kn = LIMB_AXES.anchors?.[`knee_${side2}`];
      if (ak && kn) {
        footAnkle = [kn[0], ak[1]];
        const shankLen = Math.abs(mapY(ak[1]) - mapY(kn[1]));
        const newLen = shankLen + 2 * PIVOT_PAD;
        const newHalfH = Math.max(1e-3, newLen / 2 - radius);
        length = newLen;
        halfHeight = newHalfH;
        centerY = (mapY(kn[1]) + mapY(ak[1])) / 2;
        centerZ = mapZ(kn[0], true);
      }
    }
    const plateOffset = rotVecByQuat(
      qVisInv,
      [0, mapY(part.cy) - centerY, mapZ(part.cx, !!spec.leg) - centerZ]
    );
    const cy = centerY;
    const totalMass = spec.massPct / 100 * cfg.mass;
    const solePct = spec.soleMassPct ?? 0;
    const mainMass = totalMass - solePct / 100 * cfg.mass;
    const colliders = [];
    const mainCom = comOffset(length, spec.comRatio, spec.proximal);
    const mainIz = mainMass * Math.pow(spec.gyrationRatio * length, 2);
    colliders.push({
      shape: "capsule",
      halfHeight,
      radius,
      hx: 0,
      hy: 0,
      hz: 0,
      offsetY: 0,
      offsetZ: 0,
      mass: mainMass,
      comY: mainCom,
      inertiaZ: mainIz,
      inertiaXY: mainIz * 0.5
    });
    if (solePct > 0) {
      const soleMass = solePct / 100 * cfg.mass;
      const sfx = Math.max(0.1, cfg.soleFootScale);
      const side = spec.key === "shin_l" ? "l" : "r";
      const paw = LIMB_AXES.paw?.[side];
      const knee = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "knee_l" : "knee_r"];
      const anklePx = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "foot_l" : "foot_r"];
      const hx = soleHalfLen * sfx;
      const hz = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx;
      const soleWorldY = soleHalfThick;
      const soleWorldZ = mapZ(knee ? knee[0] : part.cx, true);
      const soleMassTotal = mainMass + soleMass;
      if (anklePx && cfg.ankleEnabled) {
        const ankleY = mapY(anklePx[1]);
        const ankleZ = mapZ(anklePx[0], true);
        const fTilt = 0;
        const fYaw = restYawOf(spec.key === "shin_l" ? "foot_l" : "foot_r");
        const fQInv = invQuatOf(restQuatOf(fTilt, fYaw));
        const soleDrop = ankleY;
        const fMidY = soleWorldY;
        const local2 = rotVecByQuat(fQInv, [0, fMidY - ankleY, soleWorldZ - ankleZ]);
        bodies.push({
          key: spec.key === "shin_l" ? "foot_l" : "foot_r",
          bone: spec.bone,
          label: spec.key === "shin_l" ? "\u5DE6\u811A\u638C" : "\u53F3\u811A\u638C",
          part,
          // 贴图仍借小腿那张（渲染层按脚部区域做 UV 扭曲）
          cx: 0,
          cy: ankleY,
          cz: ankleZ,
          restTiltRad: fTilt,
          restYawRad: fYaw,
          // 贴图板偏移：脚掌**不单独画贴图** ⇒ 用一个大偏移把它藏到小腿板之外
          plateOffset: [0, 0, 0],
          plateHidden: true,
          // ★ 渲染层据此跳过这块板
          length: soleDrop,
          radius: 0,
          halfHeight: soleDrop / 2,
          mass: soleMass,
          colliders: [{
            shape: "cuboid",
            halfHeight: 0,
            radius: 0,
            hx,
            hy: soleHalfThick,
            hz,
            offsetY: local2[1],
            offsetZ: local2[2],
            mass: soleMass,
            comY: 0,
            inertiaZ: soleMass * (hx * hx + soleHalfThick * soleHalfThick) / 3,
            inertiaXY: soleMass * (hz * hz + soleHalfThick * soleHalfThick) / 3
          }],
          leg: true
        });
        bodies.push({
          key: spec.key,
          bone: spec.bone,
          label: spec.label,
          part,
          cx: 0,
          cy,
          cz: centerZ,
          restTiltRad: tilt,
          restYawRad: yaw,
          plateOffset,
          length,
          radius,
          halfHeight,
          mass: mainMass,
          colliders: [colliders[0]],
          leg: true
        });
        continue;
      }
      const local = rotVecByQuat(qRestInv, [0, soleWorldY - centerY, soleWorldZ - centerZ]);
      colliders.push({
        shape: "cuboid",
        halfHeight: 0,
        radius: 0,
        hx,
        hy: soleHalfThick,
        hz,
        offsetY: local[1],
        offsetZ: local[2],
        mass: soleMass,
        comY: 0,
        inertiaZ: soleMass * (hx * hx + soleHalfThick * soleHalfThick) / 3,
        inertiaXY: soleMass * (hz * hz + soleHalfThick * soleHalfThick) / 3
      });
    }
    if (spec.key === "torso" && K > 1) {
      const segLen = length / K;
      const segMass = totalMass / K;
      const hx = radius, hz = radius * 0.9;
      for (let s = 0; s < K; s++) {
        const cyS = cy - length / 2 + (s + 0.5) * segLen;
        const iZ = segMass * (hx * hx + segLen / 2 * (segLen / 2)) / 3;
        const iX = segMass * (segLen / 2 * (segLen / 2) + hz * hz) / 3;
        bodies.push({
          key: s === 0 ? "torso" : `spine${s + 1}`,
          bone: spec.bone,
          label: s === 0 ? "\u9AA8\u76C6" : `\u810A\u690E${s + 1}`,
          part,
          cx: 0,
          cy: cyS,
          cz: mapZ(part.cx, false),
          restTiltRad: 0,
          // 躯干不设静倾角（脊柱段要同朝向才能 LBS）
          restYawRad: 0,
          plateOffset: [0, 0, 0],
          // 蒙皮板由 viewer 逐段插值，不用刚体中心
          length: segLen,
          radius,
          halfHeight: segLen / 2,
          mass: segMass,
          colliders: [{
            shape: "cuboid",
            halfHeight: 0,
            radius: 0,
            hx,
            hy: segLen / 2,
            hz,
            offsetY: 0,
            offsetZ: 0,
            mass: segMass,
            comY: 0,
            inertiaZ: iZ,
            inertiaXY: iX
          }],
          leg: false,
          texSlice: { index: s, count: K }
        });
      }
      continue;
    }
    bodies.push({
      key: spec.key,
      bone: spec.bone,
      label: spec.label,
      part,
      cx: 0,
      // ★ 素材是正面视图，没有深度信息 ⇒ 前向一律 0
      cy: centerY,
      cz: centerZ,
      restTiltRad: tilt,
      restYawRad: yaw,
      plateOffset,
      length,
      radius,
      halfHeight,
      mass: totalMass,
      colliders,
      leg: !!spec.leg
    });
  }
  const byKey = new Map(bodies.map((b) => [b.key, b]));
  byKeyRef = byKey;
  const jointMetaByName = new Map(META.joints.map((j) => [j.name, j]));
  const joints = [];
  const JOINT_ORDER_ACTIVE = JOINT_ORDER.filter((n) => cfg.ankleEnabled || !n.startsWith("foot_"));
  JOINT_ORDER_ACTIVE.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u5173\u8282 ${name}`);
    const isAnkle = jm.child === "foot_l" || jm.child === "foot_r";
    const childPart = PART_BY_KEY.get(jm.child) ?? PART_BY_KEY.get(isAnkle ? jm.parent : "");
    if (!childPart) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u5B50\u90E8\u4EF6\u5143\u6570\u636E\u4E0D\u5B58\u5728`);
    const [axPx, ayPx] = anchorPx(name, jm);
    const parent = byKey.get(attachTo(jm.parent, mapY(ayPx)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    const wy = mapY(ayPx);
    const wz = mapZ(axPx, stanceHere);
    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    const tau = JOINT_MAX_TORQUE[name] ?? 100;
    const dParent = rotVecByQuat(
      invQuatOf(restQuatOf(parent.restTiltRad, parent.restYawRad)),
      [wx - parent.cx, wy - parent.cy, wz - parent.cz]
    );
    const dChild = rotVecByQuat(
      invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [wx - child.cx, wy - child.cy, wz - child.cz]
    );
    joints.push({
      name,
      index,
      parentKey: parent.key,
      childKey: child.key,
      wx,
      wy,
      wz,
      parentLocal: dParent,
      childLocal: dChild,
      // ★ 静姿态读数（父静姿态⁻¹ ⊗ 子静姿态），ragdoll 用它把关节零位挪到素材姿势
      restRad: quatToRotVec(quatRel(
        restQuatOf(parent.restTiltRad, parent.restYawRad),
        restQuatOf(child.restTiltRad, child.restYawRad)
      )),
      minRad: [-xy[0] * DEG, -xy[1] * DEG, flexMin],
      maxRad: [xy[0] * DEG, xy[1] * DEG, flexMax],
      maxTorque: [tau * TORQUE_AXIS_FACTOR[0], tau * TORQUE_AXIS_FACTOR[1], tau * TORQUE_AXIS_FACTOR[2]]
    });
  });
  if (K > 1) {
    const SPINE_XY_DEG = [15, 20];
    const SPINE_FLEX_DEG = [-25, 25];
    const SPINE_TAU = 120;
    for (let s = 0; s < K - 1; s++) {
      const p = byKey.get(segKey(s));
      const c = byKey.get(segKey(s + 1));
      if (!p || !c) throw new Error(`[skeleton] \u810A\u67F1\u6BB5 ${s} \u4E0D\u5B58\u5728`);
      const wy = (p.cy + c.cy) / 2;
      const wx = 0, wz = 0;
      joints.push({
        name: `spine${s + 1}`,
        index: joints.length,
        // ★ 接在 JOINT_ORDER 之后 = 网络输出接在后面
        parentKey: p.key,
        childKey: c.key,
        wx,
        wy,
        wz,
        parentLocal: [wx - p.cx, wy - p.cy, wz - p.cz],
        childLocal: [wx - c.cx, wy - c.cy, wz - c.cz],
        restRad: [0, 0, 0],
        // 躯干段无静倾角 ⇒ 关节零位就是素材姿势
        minRad: [-SPINE_XY_DEG[0] * DEG, -SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[0] * DEG],
        maxRad: [SPINE_XY_DEG[0] * DEG, SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[1] * DEG],
        maxTorque: [
          SPINE_TAU * TORQUE_AXIS_FACTOR[0],
          SPINE_TAU * TORQUE_AXIS_FACTOR[1],
          SPINE_TAU * TORQUE_AXIS_FACTOR[2]
        ]
      });
    }
  }
  const massTotal = bodies.reduce((s, b) => s + b.mass, 0);
  return {
    cfg,
    px2m,
    centerPx,
    groundPx,
    bodies,
    joints,
    totalHeight: extent.h * px2m,
    massTotal
  };
}

// tools/_geo.ts
var require2 = createRequire(import.meta.url);
{
  const p = require2.resolve("@dimforge/rapier3d/rapier_wasm3d_bg.wasm");
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = rapier_wasm3d_bg_exports[i.name];
    if (typeof f === "function") (imp[i.module] ??= {})[i.name] = f;
  }
  const r = await WebAssembly.instantiate(c, imp);
  __wbg_set_wasm(r.instance ? r.instance.exports : r.exports);
}
var sk = buildSkeleton(DEFAULT_CONFIG);
for (const k of ["thigh_l", "shin_l", "torso"]) {
  const b = sk.bodies.find((x) => x.key === k);
  if (b) console.log(k.padEnd(8) + " cy=" + b.cy.toFixed(3) + " cz=" + b.cz.toFixed(3) + " len=" + b.length.toFixed(3) + " hh=" + b.halfHeight.toFixed(3) + " r=" + b.radius.toFixed(3));
}
for (const n of ["hip_l", "knee_l", "shoulder_l", "elbow_l"]) {
  const j = sk.joints.find((x) => x.name === n);
  console.log(n.padEnd(10) + " " + j.parentKey + "->" + j.childKey + " \u9650\u4F4D [" + j.minRad.map((v) => (v * 57.3).toFixed(0)).join(",") + "] .. [" + j.maxRad.map((v) => (v * 57.3).toFixed(0)).join(",") + "] \u529B\u77E9 " + j.maxTorque.map((v) => v.toFixed(0)).join(","));
}
