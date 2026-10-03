var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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
function __wbg_set_wasm(val) {
  wasm = val;
}
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
function getFloat64Memory0() {
  if (cachedFloat64Memory0 === null || cachedFloat64Memory0.byteLength === 0) {
    cachedFloat64Memory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64Memory0;
}
function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}
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
function getFloat32Memory0() {
  if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
    cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32Memory0;
}
function addBorrowedObject(obj) {
  if (stack_pointer == 1) throw new Error("out of js stack");
  heap[--stack_pointer] = obj;
  return stack_pointer;
}
function getArrayF32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
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
var wasm, heap, heap_next, cachedFloat64Memory0, cachedInt32Memory0, lTextDecoder, cachedTextDecoder, cachedUint8Memory0, cachedFloat32Memory0, stack_pointer, cachedUint32Memory0, WASM_VECTOR_LEN, RawFeatureType, RawShapeType, RawJointAxis, RawRigidBodyType, RawMotorModel, RawJointType, RawBroadPhaseFinalization, RawBroadPhase, RawCCDSolverFinalization, RawCCDSolver, RawCharacterCollisionFinalization, RawCharacterCollision, RawColliderSetFinalization, RawColliderSet, RawColliderShapeCastHitFinalization, RawColliderShapeCastHit, RawContactForceEventFinalization, RawContactForceEvent, RawContactManifoldFinalization, RawContactManifold, RawContactPairFinalization, RawContactPair, RawDebugRenderPipelineFinalization, RawDebugRenderPipeline, RawDeserializedWorldFinalization, RawDeserializedWorld, RawDynamicRayCastVehicleControllerFinalization, RawDynamicRayCastVehicleController, RawEventQueueFinalization, RawEventQueue, RawGenericJointFinalization, RawGenericJoint, RawImpulseJointSetFinalization, RawImpulseJointSet, RawIntegrationParametersFinalization, RawIntegrationParameters, RawIslandManagerFinalization, RawIslandManager, RawKinematicCharacterControllerFinalization, RawKinematicCharacterController, RawMultibodyJointSetFinalization, RawMultibodyJointSet, RawNarrowPhaseFinalization, RawNarrowPhase, RawPhysicsPipelineFinalization, RawPhysicsPipeline, RawPointColliderProjectionFinalization, RawPointColliderProjection, RawPointProjectionFinalization, RawPointProjection, RawQueryPipelineFinalization, RawQueryPipeline, RawRayColliderHitFinalization, RawRayColliderHit, RawRayColliderIntersectionFinalization, RawRayColliderIntersection, RawRayIntersectionFinalization, RawRayIntersection, RawRigidBodySetFinalization, RawRigidBodySet, RawRotationFinalization, RawRotation, RawSdpMatrix3Finalization, RawSdpMatrix3, RawSerializationPipelineFinalization, RawSerializationPipeline, RawShapeFinalization, RawShape, RawShapeCastHitFinalization, RawShapeCastHit, RawShapeContactFinalization, RawShapeContact, RawVectorFinalization, RawVector;
var init_rapier_wasm3d_bg = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/rapier_wasm3d_bg.js"() {
    heap = new Array(128).fill(void 0);
    heap.push(void 0, null, true, false);
    heap_next = heap.length;
    cachedFloat64Memory0 = null;
    cachedInt32Memory0 = null;
    lTextDecoder = typeof TextDecoder === "undefined" ? (0, module.require)("util").TextDecoder : TextDecoder;
    cachedTextDecoder = new lTextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    cachedUint8Memory0 = null;
    cachedFloat32Memory0 = null;
    stack_pointer = 128;
    cachedUint32Memory0 = null;
    WASM_VECTOR_LEN = 0;
    RawFeatureType = Object.freeze({ Vertex: 0, "0": "Vertex", Edge: 1, "1": "Edge", Face: 2, "2": "Face", Unknown: 3, "3": "Unknown" });
    RawShapeType = Object.freeze({ Ball: 0, "0": "Ball", Cuboid: 1, "1": "Cuboid", Capsule: 2, "2": "Capsule", Segment: 3, "3": "Segment", Polyline: 4, "4": "Polyline", Triangle: 5, "5": "Triangle", TriMesh: 6, "6": "TriMesh", HeightField: 7, "7": "HeightField", Compound: 8, "8": "Compound", ConvexPolyhedron: 9, "9": "ConvexPolyhedron", Cylinder: 10, "10": "Cylinder", Cone: 11, "11": "Cone", RoundCuboid: 12, "12": "RoundCuboid", RoundTriangle: 13, "13": "RoundTriangle", RoundCylinder: 14, "14": "RoundCylinder", RoundCone: 15, "15": "RoundCone", RoundConvexPolyhedron: 16, "16": "RoundConvexPolyhedron", HalfSpace: 17, "17": "HalfSpace" });
    RawJointAxis = Object.freeze({ LinX: 0, "0": "LinX", LinY: 1, "1": "LinY", LinZ: 2, "2": "LinZ", AngX: 3, "3": "AngX", AngY: 4, "4": "AngY", AngZ: 5, "5": "AngZ" });
    RawRigidBodyType = Object.freeze({ Dynamic: 0, "0": "Dynamic", Fixed: 1, "1": "Fixed", KinematicPositionBased: 2, "2": "KinematicPositionBased", KinematicVelocityBased: 3, "3": "KinematicVelocityBased" });
    RawMotorModel = Object.freeze({ AccelerationBased: 0, "0": "AccelerationBased", ForceBased: 1, "1": "ForceBased" });
    RawJointType = Object.freeze({ Revolute: 0, "0": "Revolute", Fixed: 1, "1": "Fixed", Prismatic: 2, "2": "Prismatic", Rope: 3, "3": "Rope", Spring: 4, "4": "Spring", Spherical: 5, "5": "Spherical", Generic: 6, "6": "Generic" });
    RawBroadPhaseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawbroadphase_free(ptr >>> 0));
    RawBroadPhase = class _RawBroadPhase {
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
    RawCCDSolverFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawccdsolver_free(ptr >>> 0));
    RawCCDSolver = class {
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
    RawCharacterCollisionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcharactercollision_free(ptr >>> 0));
    RawCharacterCollision = class {
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
    RawColliderSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcolliderset_free(ptr >>> 0));
    RawColliderSet = class _RawColliderSet {
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
    RawColliderShapeCastHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcollidershapecasthit_free(ptr >>> 0));
    RawColliderShapeCastHit = class _RawColliderShapeCastHit {
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
    RawContactForceEventFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactforceevent_free(ptr >>> 0));
    RawContactForceEvent = class _RawContactForceEvent {
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
    RawContactManifoldFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactmanifold_free(ptr >>> 0));
    RawContactManifold = class _RawContactManifold {
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
    RawContactPairFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawcontactpair_free(ptr >>> 0));
    RawContactPair = class _RawContactPair {
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
    RawDebugRenderPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdebugrenderpipeline_free(ptr >>> 0));
    RawDebugRenderPipeline = class {
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
    RawDeserializedWorldFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdeserializedworld_free(ptr >>> 0));
    RawDeserializedWorld = class _RawDeserializedWorld {
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
    RawDynamicRayCastVehicleControllerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawdynamicraycastvehiclecontroller_free(ptr >>> 0));
    RawDynamicRayCastVehicleController = class {
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
    RawEventQueueFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_raweventqueue_free(ptr >>> 0));
    RawEventQueue = class {
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
    RawGenericJointFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawgenericjoint_free(ptr >>> 0));
    RawGenericJoint = class _RawGenericJoint {
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
    RawImpulseJointSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawimpulsejointset_free(ptr >>> 0));
    RawImpulseJointSet = class _RawImpulseJointSet {
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
    RawIntegrationParametersFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawintegrationparameters_free(ptr >>> 0));
    RawIntegrationParameters = class _RawIntegrationParameters {
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
    RawIslandManagerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawislandmanager_free(ptr >>> 0));
    RawIslandManager = class _RawIslandManager {
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
    RawKinematicCharacterControllerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawkinematiccharactercontroller_free(ptr >>> 0));
    RawKinematicCharacterController = class {
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
    RawMultibodyJointSetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawmultibodyjointset_free(ptr >>> 0));
    RawMultibodyJointSet = class _RawMultibodyJointSet {
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
    RawNarrowPhaseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawnarrowphase_free(ptr >>> 0));
    RawNarrowPhase = class _RawNarrowPhase {
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
    RawPhysicsPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawphysicspipeline_free(ptr >>> 0));
    RawPhysicsPipeline = class {
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
    RawPointColliderProjectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawpointcolliderprojection_free(ptr >>> 0));
    RawPointColliderProjection = class _RawPointColliderProjection {
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
    RawPointProjectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawpointprojection_free(ptr >>> 0));
    RawPointProjection = class _RawPointProjection {
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
    RawQueryPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawquerypipeline_free(ptr >>> 0));
    RawQueryPipeline = class {
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
    RawRayColliderHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawraycolliderhit_free(ptr >>> 0));
    RawRayColliderHit = class _RawRayColliderHit {
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
    RawRayColliderIntersectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawraycolliderintersection_free(ptr >>> 0));
    RawRayColliderIntersection = class _RawRayColliderIntersection {
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
    RawRayIntersectionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrayintersection_free(ptr >>> 0));
    RawRayIntersection = class _RawRayIntersection {
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
    RawRigidBodySetFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrigidbodyset_free(ptr >>> 0));
    RawRigidBodySet = class _RawRigidBodySet {
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
    RawRotationFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawrotation_free(ptr >>> 0));
    RawRotation = class _RawRotation {
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
    RawSdpMatrix3Finalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawsdpmatrix3_free(ptr >>> 0));
    RawSdpMatrix3 = class _RawSdpMatrix3 {
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
    RawSerializationPipelineFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawserializationpipeline_free(ptr >>> 0));
    RawSerializationPipeline = class {
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
    RawShapeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshape_free(ptr >>> 0));
    RawShape = class _RawShape {
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
    RawShapeCastHitFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshapecasthit_free(ptr >>> 0));
    RawShapeCastHit = class _RawShapeCastHit {
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
    RawShapeContactFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawshapecontact_free(ptr >>> 0));
    RawShapeContact = class _RawShapeContact {
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
    RawVectorFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm.__wbg_rawvector_free(ptr >>> 0));
    RawVector = class _RawVector {
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
  }
});

// src/data/parts.json
var parts_default;
var init_parts = __esm({
  "src/data/parts.json"() {
    parts_default = {
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
  }
});

// src/data/limbAxes.json
var limbAxes_default;
var init_limbAxes = __esm({
  "src/data/limbAxes.json"() {
    limbAxes_default = {
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
  }
});

// src/core/partsMeta.ts
var ANKLE_JOINTS, HIP_LIMIT, meta, META, PART_BY_KEY, LIMB_AXES;
var init_partsMeta = __esm({
  "src/core/partsMeta.ts"() {
    "use strict";
    init_parts();
    init_limbAxes();
    ANKLE_JOINTS = [
      { name: "foot_l", parent: "shin_l", child: "foot_l", x: 454.5, y: 2792, limitDeg: [-10, 18] },
      { name: "foot_r", parent: "shin_r", child: "foot_r", x: 1110.5, y: 2792, limitDeg: [-10, 18] }
    ];
    HIP_LIMIT = [-95, 100];
    meta = parts_default;
    for (const j of meta.joints) {
      if (j.name === "hip_l" || j.name === "hip_r") j.limitDeg = [HIP_LIMIT[0], HIP_LIMIT[1]];
    }
    if (!meta.joints.some((j) => j.name === "foot_l")) meta.joints.push(...ANKLE_JOINTS);
    META = meta;
    PART_BY_KEY = new Map(
      META.parts.map((p) => [p.key, p])
    );
    LIMB_AXES = limbAxes_default;
  }
});

// src/core/skeleton.ts
var skeleton_exports = {};
__export(skeleton_exports, {
  DEFAULT_CONFIG: () => DEFAULT_CONFIG,
  JOINT_LIMITS_XY_DEG: () => JOINT_LIMITS_XY_DEG,
  JOINT_MAX_SPEED: () => JOINT_MAX_SPEED,
  JOINT_MAX_TORQUE: () => JOINT_MAX_TORQUE,
  JOINT_ORDER: () => JOINT_ORDER,
  SEGMENTS: () => SEGMENTS,
  TORQUE_AXIS_FACTOR: () => TORQUE_AXIS_FACTOR,
  assertColliderMass: () => assertColliderMass,
  assertJointAnchors: () => assertJointAnchors,
  assertMassBudget: () => assertMassBudget,
  buildSkeleton: () => buildSkeleton,
  hasJoint: () => hasJoint,
  invQuatOf: () => invQuatOf,
  jointIndexByName: () => jointIndexByName,
  quatToRotVec: () => quatToRotVec,
  restQuatOf: () => restQuatOf,
  restVisualQuatOf: () => restVisualQuatOf,
  rotVecByQuat: () => rotVecByQuat,
  spineJointNames: () => spineJointNames
});
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
function jointIndexByName(sk2, name) {
  for (let i = 0; i < sk2.joints.length; i++) if (sk2.joints[i].name === name) return i;
  return -1;
}
function hasJoint(sk2, name) {
  return sk2.joints.some((j) => j.name === name);
}
function spineJointNames(sk2) {
  const out = [];
  for (const j of sk2.joints) if (/^spine\d+$/.test(j.name)) out.push(j.name);
  return out.sort();
}
function anchorPx(name, jm) {
  const a = LIMB_AXES.anchors[name];
  return a ? [a[0], a[1]] : [jm.x, jm.y];
}
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
  const SOLE_GROUND_CORR = 0;
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
        const local2 = rotVecByQuat(fQInv, [0, fMidY - ankleY - SOLE_GROUND_CORR, 0]);
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
    const stretch = /^(knee|foot)_/.test(name) ? cfg.legStretch : 0;
    const wy = mapY(ayPx) - stretch * (legKeys.has(jm.parent) ? 1 : 0);
    const wz = mapZ(axPx, stanceHere);
    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    const tau = /^(foot|ankle)_/.test(name) ? cfg.ankleTorque : JOINT_MAX_TORQUE[name] ?? 100;
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
function assertMassBudget() {
  const sum = SEGMENTS.reduce((s, x) => s + x.massPct, 0);
  if (Math.abs(sum - 100) > 1e-6) {
    throw new Error(`[skeleton] \u73AF\u8282\u8D28\u91CF\u6BD4\u4E4B\u548C = ${sum}%\uFF0C\u5E94\u4E3A 100%`);
  }
  return sum;
}
function assertColliderMass(sk2) {
  for (const b of sk2.bodies) {
    const s = b.colliders.reduce((a, c) => a + c.mass, 0);
    if (Math.abs(s - b.mass) > 1e-9) {
      throw new Error(`[skeleton] ${b.key} collider \u8D28\u91CF\u548C ${s} \u2260 \u521A\u4F53\u8D28\u91CF ${b.mass}`);
    }
  }
}
function assertJointAnchors(sk2) {
  let worst = 0;
  for (const j of sk2.joints) {
    const p = sk2.bodies.find((b) => b.key === j.parentKey);
    const c = sk2.bodies.find((b) => b.key === j.childKey);
    for (const [b, l, tag] of [[p, j.parentLocal, "P"], [c, j.childLocal, "C"]]) {
      const reach = b.halfHeight + b.radius;
      const d = Math.hypot(l[0], l[1], l[2]);
      const over = d - reach;
      if (over > worst) worst = over;
      if (over > 1e-4) {
        console.log(`      [\u8D8A\u754C] ${j.name}.${tag} \u5C40\u90E8(${l.map((v) => (v * 1e3).toFixed(0)).join(",")})mm |d|=${(d * 1e3).toFixed(1)}mm > reach=${(reach * 1e3).toFixed(1)}mm  \u8D8A ${(over * 1e3).toFixed(1)}mm`);
      }
    }
  }
  return worst;
}
var DEFAULT_CONFIG, SEGMENTS, JOINT_ORDER, JOINT_MAX_SPEED, JOINT_MAX_TORQUE, TORQUE_AXIS_FACTOR, JOINT_LIMITS_XY_DEG, DEG;
var init_skeleton = __esm({
  "src/core/skeleton.ts"() {
    "use strict";
    init_partsMeta();
    DEFAULT_CONFIG = {
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
      legStretch: 0.02,
      /**
       * ★ 踝（跖屈肌）力矩上限 N·m。**A 方案的核心参数。**
       *   文献依据：人类跖屈肌 MVC ~120~140 N·m；
       *   Neptune/Perry, Front Neurol 2019, 10:999 —— 跖屈肌是 CoM 推进的**主引擎**，
       *   "the work produced by these muscles has been **four times more efficient** than
       *    the work produced by the hip muscles to sustain the CoM increment during
       *    the single-stance period"。
       *   为什么必须抬：把 CoP 从脚底中心推到脚尖需要 ≈ 体重 × 足半长 ≈ 30×9.81×0.10 ≈ 29 N·m，
       *   推到边缘 ≈ 35 N·m。原来的 45 N·m 名义上够，但实测只用到声明值的 18~28%
       *   ⇒ 踝力矩对动力学**零效力**，CoP 移不动 ⇒ 承重转移无法发生。
       *   留空/默认 = JOINT_MAX_TORQUE 的 45（探针按此档扫描）。
       */
      //   legStretch=0.02 由 probe-arch 扫描定值：终 CoM +0.048（其余档 −0.25~−0.66）、离地峰 103mm
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
    SEGMENTS = [
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
    JOINT_ORDER = [
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
    JOINT_MAX_SPEED = 9;
    JOINT_MAX_TORQUE = {
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
      // ★ 会被 cfg.ankleMaxTorque 覆盖
      foot_r: 45
    };
    TORQUE_AXIS_FACTOR = [0.6, 0.35, 1];
    JOINT_LIMITS_XY_DEG = {
      neck: [30, 70],
      shoulder_l: [75, 65],
      shoulder_r: [75, 65],
      elbow_l: [14, 16],
      elbow_r: [14, 16],
      hip_l: [45, 40],
      hip_r: [45, 40],
      knee_l: [6, 8],
      knee_r: [6, 8],
      // ★★ 踝：**额状面自由度按单腿站立文献放宽**（2026-10-02）。
      //   X = 内翻/外翻（pronation/supination，绕足长轴）；Y = 轴向内外旋。
      //   原值 `[8, 6]` 的注释写"踝的侧向自由度不是走路的主自由度" —— 这在**双脚站立**
      //   成立，但**单腿站立恰恰相反**：
      //     · Liu et al., J Biomech 2012 —— "Unlike double-limb stance during which small
      //       body sway is found primarily in the sagittal plane, **single limb stance** showed
      //       the inter-joint coordination mainly in the **transverse** and **frontal** plane
      //       (ankle and hip internal/external rotations, **ankle inversion/eversion**)"
      //     · 同文给出额状面力学链："the whole body center of mass moves away from the
      //       supporting leg inducing a **lateral bending (hip abduction/adduction) moment
      //       that is equilibrated at the ankle level by supination or pronation of the ankle**
      //       that involves axial rotation"
      //     · 人体踝的被动 ROM：内翻 ~35°、外翻 ~14°；站立期功能性使用更小，
      //       取 **X=±14°（覆盖外翻全范围）/ Y=±10°** 作为可动上限。
      //   ⇒ 侧向自由度不是"放开就会乱翻"，而是**单腿平衡的必要执行器**。
      foot_l: [14, 10],
      foot_r: [14, 10]
    };
    DEG = Math.PI / 180;
  }
});

// rapier-wasm-stub:./rapier_wasm3d_bg.wasm
var rapier_wasm3d_bg_exports2 = {};
__export(rapier_wasm3d_bg_exports2, {
  default: () => rapier_wasm3d_bg_default
});
var rapier_wasm3d_bg_default;
var init_rapier_wasm3d_bg2 = __esm({
  "rapier-wasm-stub:./rapier_wasm3d_bg.wasm"() {
    rapier_wasm3d_bg_default = {};
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/rapier_wasm3d.js
var init_rapier_wasm3d = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/rapier_wasm3d.js"() {
    init_rapier_wasm3d_bg2();
    init_rapier_wasm3d_bg();
    init_rapier_wasm3d_bg();
    __wbg_set_wasm(rapier_wasm3d_bg_exports2);
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/raw.js
var init_raw = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/raw.js"() {
    init_rapier_wasm3d();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/math.js
var Vector3, VectorOps, Quaternion, RotationOps, SdpMatrix3, SdpMatrix3Ops;
var init_math = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/math.js"() {
    init_raw();
    Vector3 = class {
      constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
    };
    VectorOps = class _VectorOps {
      static new(x, y, z) {
        return new Vector3(x, y, z);
      }
      static intoRaw(v) {
        return new RawVector(v.x, v.y, v.z);
      }
      static zeros() {
        return _VectorOps.new(0, 0, 0);
      }
      // FIXME: type ram: RawVector?
      static fromRaw(raw) {
        if (!raw)
          return null;
        let res = _VectorOps.new(raw.x, raw.y, raw.z);
        raw.free();
        return res;
      }
      static copy(out, input) {
        out.x = input.x;
        out.y = input.y;
        out.z = input.z;
      }
    };
    Quaternion = class {
      constructor(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
      }
    };
    RotationOps = class {
      static identity() {
        return new Quaternion(0, 0, 0, 1);
      }
      static fromRaw(raw) {
        if (!raw)
          return null;
        let res = new Quaternion(raw.x, raw.y, raw.z, raw.w);
        raw.free();
        return res;
      }
      static intoRaw(rot) {
        return new RawRotation(rot.x, rot.y, rot.z, rot.w);
      }
      static copy(out, input) {
        out.x = input.x;
        out.y = input.y;
        out.z = input.z;
        out.w = input.w;
      }
    };
    SdpMatrix3 = class {
      constructor(elements) {
        this.elements = elements;
      }
      /**
       * Matrix element at row 1, column 1.
       */
      get m11() {
        return this.elements[0];
      }
      /**
       * Matrix element at row 1, column 2.
       */
      get m12() {
        return this.elements[1];
      }
      /**
       * Matrix element at row 2, column 1.
       */
      get m21() {
        return this.m12;
      }
      /**
       * Matrix element at row 1, column 3.
       */
      get m13() {
        return this.elements[2];
      }
      /**
       * Matrix element at row 3, column 1.
       */
      get m31() {
        return this.m13;
      }
      /**
       * Matrix element at row 2, column 2.
       */
      get m22() {
        return this.elements[3];
      }
      /**
       * Matrix element at row 2, column 3.
       */
      get m23() {
        return this.elements[4];
      }
      /**
       * Matrix element at row 3, column 2.
       */
      get m32() {
        return this.m23;
      }
      /**
       * Matrix element at row 3, column 3.
       */
      get m33() {
        return this.elements[5];
      }
    };
    SdpMatrix3Ops = class {
      static fromRaw(raw) {
        const sdpMatrix3 = new SdpMatrix3(raw.elements());
        raw.free();
        return sdpMatrix3;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/rigid_body.js
var RigidBodyType, RigidBody, RigidBodyDesc;
var init_rigid_body = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/rigid_body.js"() {
    init_math();
    init_math();
    (function(RigidBodyType2) {
      RigidBodyType2[RigidBodyType2["Dynamic"] = 0] = "Dynamic";
      RigidBodyType2[RigidBodyType2["Fixed"] = 1] = "Fixed";
      RigidBodyType2[RigidBodyType2["KinematicPositionBased"] = 2] = "KinematicPositionBased";
      RigidBodyType2[RigidBodyType2["KinematicVelocityBased"] = 3] = "KinematicVelocityBased";
    })(RigidBodyType || (RigidBodyType = {}));
    RigidBody = class {
      constructor(rawSet, colliderSet, handle) {
        this.rawSet = rawSet;
        this.colliderSet = colliderSet;
        this.handle = handle;
      }
      /** @internal */
      finalizeDeserialization(colliderSet) {
        this.colliderSet = colliderSet;
      }
      /**
       * Checks if this rigid-body is still valid (i.e. that it has
       * not been deleted from the rigid-body set yet.
       */
      isValid() {
        return this.rawSet.contains(this.handle);
      }
      /**
       * Locks or unlocks the ability of this rigid-body to translate.
       *
       * @param locked - If `true`, this rigid-body will no longer translate due to forces and impulses.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       */
      lockTranslations(locked, wakeUp) {
        return this.rawSet.rbLockTranslations(this.handle, locked, wakeUp);
      }
      /**
       * Locks or unlocks the ability of this rigid-body to rotate.
       *
       * @param locked - If `true`, this rigid-body will no longer rotate due to torques and impulses.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       */
      lockRotations(locked, wakeUp) {
        return this.rawSet.rbLockRotations(this.handle, locked, wakeUp);
      }
      // #if DIM3
      /**
       * Locks or unlocks the ability of this rigid-body to translate along individual coordinate axes.
       *
       * @param enableX - If `false`, this rigid-body will no longer translate due to torques and impulses, along the X coordinate axis.
       * @param enableY - If `false`, this rigid-body will no longer translate due to torques and impulses, along the Y coordinate axis.
       * @param enableZ - If `false`, this rigid-body will no longer translate due to torques and impulses, along the Z coordinate axis.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       */
      setEnabledTranslations(enableX, enableY, enableZ, wakeUp) {
        return this.rawSet.rbSetEnabledTranslations(this.handle, enableX, enableY, enableZ, wakeUp);
      }
      /**
       * Locks or unlocks the ability of this rigid-body to translate along individual coordinate axes.
       *
       * @param enableX - If `false`, this rigid-body will no longer translate due to torques and impulses, along the X coordinate axis.
       * @param enableY - If `false`, this rigid-body will no longer translate due to torques and impulses, along the Y coordinate axis.
       * @param enableZ - If `false`, this rigid-body will no longer translate due to torques and impulses, along the Z coordinate axis.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       * @deprecated use `this.setEnabledTranslations` with the same arguments instead.
       */
      restrictTranslations(enableX, enableY, enableZ, wakeUp) {
        this.setEnabledTranslations(enableX, enableY, enableZ, wakeUp);
      }
      /**
       * Locks or unlocks the ability of this rigid-body to rotate along individual coordinate axes.
       *
       * @param enableX - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the X coordinate axis.
       * @param enableY - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the Y coordinate axis.
       * @param enableZ - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the Z coordinate axis.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       */
      setEnabledRotations(enableX, enableY, enableZ, wakeUp) {
        return this.rawSet.rbSetEnabledRotations(this.handle, enableX, enableY, enableZ, wakeUp);
      }
      /**
       * Locks or unlocks the ability of this rigid-body to rotate along individual coordinate axes.
       *
       * @param enableX - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the X coordinate axis.
       * @param enableY - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the Y coordinate axis.
       * @param enableZ - If `false`, this rigid-body will no longer rotate due to torques and impulses, along the Z coordinate axis.
       * @param wakeUp - If `true`, this rigid-body will be automatically awaken if it is currently asleep.
       * @deprecated use `this.setEnabledRotations` with the same arguments instead.
       */
      restrictRotations(enableX, enableY, enableZ, wakeUp) {
        this.setEnabledRotations(enableX, enableY, enableZ, wakeUp);
      }
      // #endif
      /**
       * The dominance group, in [-127, +127] this rigid-body is part of.
       */
      dominanceGroup() {
        return this.rawSet.rbDominanceGroup(this.handle);
      }
      /**
       * Sets the dominance group of this rigid-body.
       *
       * @param group - The dominance group of this rigid-body. Must be a signed integer in the range [-127, +127].
       */
      setDominanceGroup(group) {
        this.rawSet.rbSetDominanceGroup(this.handle, group);
      }
      /**
       * The number of additional solver iterations that will be run for this
       * rigid-body and everything that interacts with it directly or indirectly
       * through contacts or joints.
       */
      additionalSolverIterations() {
        return this.rawSet.rbAdditionalSolverIterations(this.handle);
      }
      /**
       * Sets the number of additional solver iterations that will be run for this
       * rigid-body and everything that interacts with it directly or indirectly
       * through contacts or joints.
       *
       * Compared to increasing the global `World.numSolverIteration`, setting this
       * value lets you increase accuracy on only a subset of the scene, resulting in reduced
       * performance loss.
       *
       * @param iters - The new number of additional solver iterations (default: 0).
       */
      setAdditionalSolverIterations(iters) {
        this.rawSet.rbSetAdditionalSolverIterations(this.handle, iters);
      }
      /**
       * Enable or disable CCD (Continuous Collision Detection) for this rigid-body.
       *
       * @param enabled - If `true`, CCD will be enabled for this rigid-body.
       */
      enableCcd(enabled) {
        this.rawSet.rbEnableCcd(this.handle, enabled);
      }
      /**
       * Sets the soft-CCD prediction distance for this rigid-body.
       *
       * See the documentation of `RigidBodyDesc.setSoftCcdPrediction` for
       * additional details.
       */
      setSoftCcdPrediction(distance) {
        this.rawSet.rbSetSoftCcdPrediction(this.handle, distance);
      }
      /**
       * Gets the soft-CCD prediction distance for this rigid-body.
       *
       * See the documentation of `RigidBodyDesc.setSoftCcdPrediction` for
       * additional details.
       */
      softCcdPrediction() {
        return this.rawSet.rbSoftCcdPrediction(this.handle);
      }
      /**
       * The world-space translation of this rigid-body.
       */
      translation() {
        let res = this.rawSet.rbTranslation(this.handle);
        return VectorOps.fromRaw(res);
      }
      /**
       * The world-space orientation of this rigid-body.
       */
      rotation() {
        let res = this.rawSet.rbRotation(this.handle);
        return RotationOps.fromRaw(res);
      }
      /**
       * The world-space next translation of this rigid-body.
       *
       * If this rigid-body is kinematic this value is set by the `setNextKinematicTranslation`
       * method and is used for estimating the kinematic body velocity at the next timestep.
       * For non-kinematic bodies, this value is currently unspecified.
       */
      nextTranslation() {
        let res = this.rawSet.rbNextTranslation(this.handle);
        return VectorOps.fromRaw(res);
      }
      /**
       * The world-space next orientation of this rigid-body.
       *
       * If this rigid-body is kinematic this value is set by the `setNextKinematicRotation`
       * method and is used for estimating the kinematic body velocity at the next timestep.
       * For non-kinematic bodies, this value is currently unspecified.
       */
      nextRotation() {
        let res = this.rawSet.rbNextRotation(this.handle);
        return RotationOps.fromRaw(res);
      }
      /**
       * Sets the translation of this rigid-body.
       *
       * @param tra - The world-space position of the rigid-body.
       * @param wakeUp - Forces the rigid-body to wake-up so it is properly affected by forces if it
       *                 wasn't moving before modifying its position.
       */
      setTranslation(tra, wakeUp) {
        this.rawSet.rbSetTranslation(this.handle, tra.x, tra.y, tra.z, wakeUp);
      }
      /**
       * Sets the linear velocity of this rigid-body.
       *
       * @param vel - The linear velocity to set.
       * @param wakeUp - Forces the rigid-body to wake-up if it was asleep.
       */
      setLinvel(vel, wakeUp) {
        let rawVel = VectorOps.intoRaw(vel);
        this.rawSet.rbSetLinvel(this.handle, rawVel, wakeUp);
        rawVel.free();
      }
      /**
       * The scale factor applied to the gravity affecting
       * this rigid-body.
       */
      gravityScale() {
        return this.rawSet.rbGravityScale(this.handle);
      }
      /**
       * Sets the scale factor applied to the gravity affecting
       * this rigid-body.
       *
       * @param factor - The scale factor to set. A value of 0.0 means
       *   that this rigid-body will on longer be affected by gravity.
       * @param wakeUp - Forces the rigid-body to wake-up if it was asleep.
       */
      setGravityScale(factor, wakeUp) {
        this.rawSet.rbSetGravityScale(this.handle, factor, wakeUp);
      }
      // #if DIM3
      /**
       * Sets the rotation quaternion of this rigid-body.
       *
       * This does nothing if a zero quaternion is provided.
       *
       * @param rotation - The rotation to set.
       * @param wakeUp - Forces the rigid-body to wake-up so it is properly affected by forces if it
       * wasn't moving before modifying its position.
       */
      setRotation(rot, wakeUp) {
        this.rawSet.rbSetRotation(this.handle, rot.x, rot.y, rot.z, rot.w, wakeUp);
      }
      /**
       * Sets the angular velocity fo this rigid-body.
       *
       * @param vel - The angular velocity to set.
       * @param wakeUp - Forces the rigid-body to wake-up if it was asleep.
       */
      setAngvel(vel, wakeUp) {
        let rawVel = VectorOps.intoRaw(vel);
        this.rawSet.rbSetAngvel(this.handle, rawVel, wakeUp);
        rawVel.free();
      }
      // #endif
      /**
       * If this rigid body is kinematic, sets its future translation after the next timestep integration.
       *
       * This should be used instead of `rigidBody.setTranslation` to make the dynamic object
       * interacting with this kinematic body behave as expected. Internally, Rapier will compute
       * an artificial velocity for this rigid-body from its current position and its next kinematic
       * position. This velocity will be used to compute forces on dynamic bodies interacting with
       * this body.
       *
       * @param t - The kinematic translation to set.
       */
      setNextKinematicTranslation(t) {
        this.rawSet.rbSetNextKinematicTranslation(this.handle, t.x, t.y, t.z);
      }
      // #if DIM3
      /**
       * If this rigid body is kinematic, sets its future rotation after the next timestep integration.
       *
       * This should be used instead of `rigidBody.setRotation` to make the dynamic object
       * interacting with this kinematic body behave as expected. Internally, Rapier will compute
       * an artificial velocity for this rigid-body from its current position and its next kinematic
       * position. This velocity will be used to compute forces on dynamic bodies interacting with
       * this body.
       *
       * @param rot - The kinematic rotation to set.
       */
      setNextKinematicRotation(rot) {
        this.rawSet.rbSetNextKinematicRotation(this.handle, rot.x, rot.y, rot.z, rot.w);
      }
      // #endif
      /**
       * The linear velocity of this rigid-body.
       */
      linvel() {
        return VectorOps.fromRaw(this.rawSet.rbLinvel(this.handle));
      }
      // #if DIM3
      /**
       * The angular velocity of this rigid-body.
       */
      angvel() {
        return VectorOps.fromRaw(this.rawSet.rbAngvel(this.handle));
      }
      // #endif
      /**
       * The mass of this rigid-body.
       */
      mass() {
        return this.rawSet.rbMass(this.handle);
      }
      /**
       * The inverse mass taking into account translation locking.
       */
      effectiveInvMass() {
        return VectorOps.fromRaw(this.rawSet.rbEffectiveInvMass(this.handle));
      }
      /**
       * The inverse of the mass of a rigid-body.
       *
       * If this is zero, the rigid-body is assumed to have infinite mass.
       */
      invMass() {
        return this.rawSet.rbInvMass(this.handle);
      }
      /**
       * The center of mass of a rigid-body expressed in its local-space.
       */
      localCom() {
        return VectorOps.fromRaw(this.rawSet.rbLocalCom(this.handle));
      }
      /**
       * The world-space center of mass of the rigid-body.
       */
      worldCom() {
        return VectorOps.fromRaw(this.rawSet.rbWorldCom(this.handle));
      }
      // #if DIM3
      /**
       * The inverse of the principal angular inertia of the rigid-body.
       *
       * Components set to zero are assumed to be infinite along the corresponding principal axis.
       */
      invPrincipalInertiaSqrt() {
        return VectorOps.fromRaw(this.rawSet.rbInvPrincipalInertiaSqrt(this.handle));
      }
      // #endif
      // #if DIM3
      /**
       * The angular inertia along the principal inertia axes of the rigid-body.
       */
      principalInertia() {
        return VectorOps.fromRaw(this.rawSet.rbPrincipalInertia(this.handle));
      }
      // #endif
      // #if DIM3
      /**
       * The principal vectors of the local angular inertia tensor of the rigid-body.
       */
      principalInertiaLocalFrame() {
        return RotationOps.fromRaw(this.rawSet.rbPrincipalInertiaLocalFrame(this.handle));
      }
      // #endif
      // #if DIM3
      /**
       * The square-root of the world-space inverse angular inertia tensor of the rigid-body,
       * taking into account rotation locking.
       */
      effectiveWorldInvInertiaSqrt() {
        return SdpMatrix3Ops.fromRaw(this.rawSet.rbEffectiveWorldInvInertiaSqrt(this.handle));
      }
      // #endif
      // #if DIM3
      /**
       * The effective world-space angular inertia (that takes the potential rotation locking into account) of
       * this rigid-body.
       */
      effectiveAngularInertia() {
        return SdpMatrix3Ops.fromRaw(this.rawSet.rbEffectiveAngularInertia(this.handle));
      }
      // #endif
      /**
       * Put this rigid body to sleep.
       *
       * A sleeping body no longer moves and is no longer simulated by the physics engine unless
       * it is waken up. It can be woken manually with `this.wakeUp()` or automatically due to
       * external forces like contacts.
       */
      sleep() {
        this.rawSet.rbSleep(this.handle);
      }
      /**
       * Wakes this rigid-body up.
       *
       * A dynamic rigid-body that does not move during several consecutive frames will
       * be put to sleep by the physics engine, i.e., it will stop being simulated in order
       * to avoid useless computations.
       * This methods forces a sleeping rigid-body to wake-up. This is useful, e.g., before modifying
       * the position of a dynamic body so that it is properly simulated afterwards.
       */
      wakeUp() {
        this.rawSet.rbWakeUp(this.handle);
      }
      /**
       * Is CCD enabled for this rigid-body?
       */
      isCcdEnabled() {
        return this.rawSet.rbIsCcdEnabled(this.handle);
      }
      /**
       * The number of colliders attached to this rigid-body.
       */
      numColliders() {
        return this.rawSet.rbNumColliders(this.handle);
      }
      /**
       * Retrieves the `i-th` collider attached to this rigid-body.
       *
       * @param i - The index of the collider to retrieve. Must be a number in `[0, this.numColliders()[`.
       *         This index is **not** the same as the unique identifier of the collider.
       */
      collider(i) {
        return this.colliderSet.get(this.rawSet.rbCollider(this.handle, i));
      }
      /**
       * Sets whether this rigid-body is enabled or not.
       *
       * @param enabled - Set to `false` to disable this rigid-body and all its attached colliders.
       */
      setEnabled(enabled) {
        this.rawSet.rbSetEnabled(this.handle, enabled);
      }
      /**
       * Is this rigid-body enabled?
       */
      isEnabled() {
        return this.rawSet.rbIsEnabled(this.handle);
      }
      /**
       * The status of this rigid-body: static, dynamic, or kinematic.
       */
      bodyType() {
        return this.rawSet.rbBodyType(this.handle);
      }
      /**
       * Set a new status for this rigid-body: static, dynamic, or kinematic.
       */
      setBodyType(type, wakeUp) {
        return this.rawSet.rbSetBodyType(this.handle, type, wakeUp);
      }
      /**
       * Is this rigid-body sleeping?
       */
      isSleeping() {
        return this.rawSet.rbIsSleeping(this.handle);
      }
      /**
       * Is the velocity of this rigid-body not zero?
       */
      isMoving() {
        return this.rawSet.rbIsMoving(this.handle);
      }
      /**
       * Is this rigid-body static?
       */
      isFixed() {
        return this.rawSet.rbIsFixed(this.handle);
      }
      /**
       * Is this rigid-body kinematic?
       */
      isKinematic() {
        return this.rawSet.rbIsKinematic(this.handle);
      }
      /**
       * Is this rigid-body dynamic?
       */
      isDynamic() {
        return this.rawSet.rbIsDynamic(this.handle);
      }
      /**
       * The linear damping coefficient of this rigid-body.
       */
      linearDamping() {
        return this.rawSet.rbLinearDamping(this.handle);
      }
      /**
       * The angular damping coefficient of this rigid-body.
       */
      angularDamping() {
        return this.rawSet.rbAngularDamping(this.handle);
      }
      /**
       * Sets the linear damping factor applied to this rigid-body.
       *
       * @param factor - The damping factor to set.
       */
      setLinearDamping(factor) {
        this.rawSet.rbSetLinearDamping(this.handle, factor);
      }
      /**
       * Recompute the mass-properties of this rigid-bodies based on its currently attached colliders.
       */
      recomputeMassPropertiesFromColliders() {
        this.rawSet.rbRecomputeMassPropertiesFromColliders(this.handle, this.colliderSet.raw);
      }
      /**
       * Sets the rigid-body's additional mass.
       *
       * The total angular inertia of the rigid-body will be scaled automatically based on this additional mass. If this
       * scaling effect isn’t desired, use Self::additional_mass_properties instead of this method.
       *
       * This is only the "additional" mass because the total mass of the rigid-body is equal to the sum of this
       * additional mass and the mass computed from the colliders (with non-zero densities) attached to this rigid-body.
       *
       * That total mass (which includes the attached colliders’ contributions) will be updated at the name physics step,
       * or can be updated manually with `this.recomputeMassPropertiesFromColliders`.
       *
       * This will override any previous additional mass-properties set by `this.setAdditionalMass`,
       * `this.setAdditionalMassProperties`, `RigidBodyDesc::setAdditionalMass`, or
       * `RigidBodyDesc.setAdditionalMassfProperties` for this rigid-body.
       *
       * @param mass - The additional mass to set.
       * @param wakeUp - If `true` then the rigid-body will be woken up if it was put to sleep because it did not move for a while.
       */
      setAdditionalMass(mass, wakeUp) {
        this.rawSet.rbSetAdditionalMass(this.handle, mass, wakeUp);
      }
      // #if DIM3
      /**
       * Sets the rigid-body's additional mass-properties.
       *
       * This is only the "additional" mass-properties because the total mass-properties of the rigid-body is equal to the
       * sum of this additional mass-properties and the mass computed from the colliders (with non-zero densities) attached
       * to this rigid-body.
       *
       * That total mass-properties (which include the attached colliders’ contributions) will be updated at the name
       * physics step, or can be updated manually with `this.recomputeMassPropertiesFromColliders`.
       *
       * This will override any previous mass-properties set by `this.setAdditionalMass`,
       * `this.setAdditionalMassProperties`, `RigidBodyDesc.setAdditionalMass`, or `RigidBodyDesc.setAdditionalMassProperties`
       * for this rigid-body.
       *
       * If `wake_up` is true then the rigid-body will be woken up if it was put to sleep because it did not move for a while.
       */
      setAdditionalMassProperties(mass, centerOfMass, principalAngularInertia, angularInertiaLocalFrame, wakeUp) {
        let rawCom = VectorOps.intoRaw(centerOfMass);
        let rawPrincipalInertia = VectorOps.intoRaw(principalAngularInertia);
        let rawInertiaFrame = RotationOps.intoRaw(angularInertiaLocalFrame);
        this.rawSet.rbSetAdditionalMassProperties(this.handle, mass, rawCom, rawPrincipalInertia, rawInertiaFrame, wakeUp);
        rawCom.free();
        rawPrincipalInertia.free();
        rawInertiaFrame.free();
      }
      // #endif
      /**
       * Sets the linear damping factor applied to this rigid-body.
       *
       * @param factor - The damping factor to set.
       */
      setAngularDamping(factor) {
        this.rawSet.rbSetAngularDamping(this.handle, factor);
      }
      /**
       * Resets to zero the user forces (but not torques) applied to this rigid-body.
       *
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      resetForces(wakeUp) {
        this.rawSet.rbResetForces(this.handle, wakeUp);
      }
      /**
       * Resets to zero the user torques applied to this rigid-body.
       *
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      resetTorques(wakeUp) {
        this.rawSet.rbResetTorques(this.handle, wakeUp);
      }
      /**
       * Adds a force at the center-of-mass of this rigid-body.
       *
       * @param force - the world-space force to add to the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      addForce(force, wakeUp) {
        const rawForce = VectorOps.intoRaw(force);
        this.rawSet.rbAddForce(this.handle, rawForce, wakeUp);
        rawForce.free();
      }
      /**
       * Applies an impulse at the center-of-mass of this rigid-body.
       *
       * @param impulse - the world-space impulse to apply on the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      applyImpulse(impulse, wakeUp) {
        const rawImpulse = VectorOps.intoRaw(impulse);
        this.rawSet.rbApplyImpulse(this.handle, rawImpulse, wakeUp);
        rawImpulse.free();
      }
      // #if DIM3
      /**
       * Adds a torque at the center-of-mass of this rigid-body.
       *
       * @param torque - the world-space torque to add to the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      addTorque(torque, wakeUp) {
        const rawTorque = VectorOps.intoRaw(torque);
        this.rawSet.rbAddTorque(this.handle, rawTorque, wakeUp);
        rawTorque.free();
      }
      // #endif
      // #if DIM3
      /**
       * Applies an impulsive torque at the center-of-mass of this rigid-body.
       *
       * @param torqueImpulse - the world-space torque impulse to apply on the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      applyTorqueImpulse(torqueImpulse, wakeUp) {
        const rawTorqueImpulse = VectorOps.intoRaw(torqueImpulse);
        this.rawSet.rbApplyTorqueImpulse(this.handle, rawTorqueImpulse, wakeUp);
        rawTorqueImpulse.free();
      }
      // #endif
      /**
       * Adds a force at the given world-space point of this rigid-body.
       *
       * @param force - the world-space force to add to the rigid-body.
       * @param point - the world-space point where the impulse is to be applied on the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      addForceAtPoint(force, point, wakeUp) {
        const rawForce = VectorOps.intoRaw(force);
        const rawPoint = VectorOps.intoRaw(point);
        this.rawSet.rbAddForceAtPoint(this.handle, rawForce, rawPoint, wakeUp);
        rawForce.free();
        rawPoint.free();
      }
      /**
       * Applies an impulse at the given world-space point of this rigid-body.
       *
       * @param impulse - the world-space impulse to apply on the rigid-body.
       * @param point - the world-space point where the impulse is to be applied on the rigid-body.
       * @param wakeUp - should the rigid-body be automatically woken-up?
       */
      applyImpulseAtPoint(impulse, point, wakeUp) {
        const rawImpulse = VectorOps.intoRaw(impulse);
        const rawPoint = VectorOps.intoRaw(point);
        this.rawSet.rbApplyImpulseAtPoint(this.handle, rawImpulse, rawPoint, wakeUp);
        rawImpulse.free();
        rawPoint.free();
      }
      /**
       * Retrieves the constant force(s) the user added to this rigid-body
       * Returns zero if the rigid-body is not dynamic.
       */
      userForce() {
        return VectorOps.fromRaw(this.rawSet.rbUserForce(this.handle));
      }
      // #if DIM3
      /**
       * Retrieves the constant torque(s) the user added to this rigid-body
       * Returns zero if the rigid-body is not dynamic.
       */
      userTorque() {
        return VectorOps.fromRaw(this.rawSet.rbUserTorque(this.handle));
      }
    };
    RigidBodyDesc = class _RigidBodyDesc {
      constructor(status) {
        this.enabled = true;
        this.status = status;
        this.translation = VectorOps.zeros();
        this.rotation = RotationOps.identity();
        this.gravityScale = 1;
        this.linvel = VectorOps.zeros();
        this.mass = 0;
        this.massOnly = false;
        this.centerOfMass = VectorOps.zeros();
        this.translationsEnabledX = true;
        this.translationsEnabledY = true;
        this.angvel = VectorOps.zeros();
        this.principalAngularInertia = VectorOps.zeros();
        this.angularInertiaLocalFrame = RotationOps.identity();
        this.translationsEnabledZ = true;
        this.rotationsEnabledX = true;
        this.rotationsEnabledY = true;
        this.rotationsEnabledZ = true;
        this.linearDamping = 0;
        this.angularDamping = 0;
        this.canSleep = true;
        this.sleeping = false;
        this.ccdEnabled = false;
        this.softCcdPrediction = 0;
        this.dominanceGroup = 0;
        this.additionalSolverIterations = 0;
      }
      /**
       * A rigid-body descriptor used to build a dynamic rigid-body.
       */
      static dynamic() {
        return new _RigidBodyDesc(RigidBodyType.Dynamic);
      }
      /**
       * A rigid-body descriptor used to build a position-based kinematic rigid-body.
       */
      static kinematicPositionBased() {
        return new _RigidBodyDesc(RigidBodyType.KinematicPositionBased);
      }
      /**
       * A rigid-body descriptor used to build a velocity-based kinematic rigid-body.
       */
      static kinematicVelocityBased() {
        return new _RigidBodyDesc(RigidBodyType.KinematicVelocityBased);
      }
      /**
       * A rigid-body descriptor used to build a fixed rigid-body.
       */
      static fixed() {
        return new _RigidBodyDesc(RigidBodyType.Fixed);
      }
      /**
       * A rigid-body descriptor used to build a dynamic rigid-body.
       *
       * @deprecated The method has been renamed to `.dynamic()`.
       */
      static newDynamic() {
        return new _RigidBodyDesc(RigidBodyType.Dynamic);
      }
      /**
       * A rigid-body descriptor used to build a position-based kinematic rigid-body.
       *
       * @deprecated The method has been renamed to `.kinematicPositionBased()`.
       */
      static newKinematicPositionBased() {
        return new _RigidBodyDesc(RigidBodyType.KinematicPositionBased);
      }
      /**
       * A rigid-body descriptor used to build a velocity-based kinematic rigid-body.
       *
       * @deprecated The method has been renamed to `.kinematicVelocityBased()`.
       */
      static newKinematicVelocityBased() {
        return new _RigidBodyDesc(RigidBodyType.KinematicVelocityBased);
      }
      /**
       * A rigid-body descriptor used to build a fixed rigid-body.
       *
       * @deprecated The method has been renamed to `.fixed()`.
       */
      static newStatic() {
        return new _RigidBodyDesc(RigidBodyType.Fixed);
      }
      setDominanceGroup(group) {
        this.dominanceGroup = group;
        return this;
      }
      /**
       * Sets the number of additional solver iterations that will be run for this
       * rigid-body and everything that interacts with it directly or indirectly
       * through contacts or joints.
       *
       * Compared to increasing the global `World.numSolverIteration`, setting this
       * value lets you increase accuracy on only a subset of the scene, resulting in reduced
       * performance loss.
       *
       * @param iters - The new number of additional solver iterations (default: 0).
       */
      setAdditionalSolverIterations(iters) {
        this.additionalSolverIterations = iters;
        return this;
      }
      /**
       * Sets whether the created rigid-body will be enabled or disabled.
       * @param enabled − If set to `false` the rigid-body will be disabled at creation.
       */
      setEnabled(enabled) {
        this.enabled = enabled;
        return this;
      }
      // #if DIM3
      /**
       * Sets the initial translation of the rigid-body to create.
       *
       * @param tra - The translation to set.
       */
      setTranslation(x, y, z) {
        if (typeof x != "number" || typeof y != "number" || typeof z != "number")
          throw TypeError("The translation components must be numbers.");
        this.translation = { x, y, z };
        return this;
      }
      // #endif
      /**
       * Sets the initial rotation of the rigid-body to create.
       *
       * @param rot - The rotation to set.
       */
      setRotation(rot) {
        RotationOps.copy(this.rotation, rot);
        return this;
      }
      /**
       * Sets the scale factor applied to the gravity affecting
       * the rigid-body being built.
       *
       * @param scale - The scale factor. Set this to `0.0` if the rigid-body
       *   needs to ignore gravity.
       */
      setGravityScale(scale) {
        this.gravityScale = scale;
        return this;
      }
      /**
       * Sets the initial mass of the rigid-body being built, before adding colliders' contributions.
       *
       * @param mass − The initial mass of the rigid-body to create.
       */
      setAdditionalMass(mass) {
        this.mass = mass;
        this.massOnly = true;
        return this;
      }
      // #if DIM3
      /**
       * Sets the initial linear velocity of the rigid-body to create.
       *
       * @param x - The linear velocity to set along the `x` axis.
       * @param y - The linear velocity to set along the `y` axis.
       * @param z - The linear velocity to set along the `z` axis.
       */
      setLinvel(x, y, z) {
        if (typeof x != "number" || typeof y != "number" || typeof z != "number")
          throw TypeError("The linvel components must be numbers.");
        this.linvel = { x, y, z };
        return this;
      }
      /**
       * Sets the initial angular velocity of the rigid-body to create.
       *
       * @param vel - The angular velocity to set.
       */
      setAngvel(vel) {
        VectorOps.copy(this.angvel, vel);
        return this;
      }
      /**
       * Sets the mass properties of the rigid-body being built.
       *
       * Note that the final mass properties of the rigid-bodies depends
       * on the initial mass-properties of the rigid-body (set by this method)
       * to which is added the contributions of all the colliders with non-zero density
       * attached to this rigid-body.
       *
       * Therefore, if you want your provided mass properties to be the final
       * mass properties of your rigid-body, don't attach colliders to it, or
       * only attach colliders with densities equal to zero.
       *
       * @param mass − The initial mass of the rigid-body to create.
       * @param centerOfMass − The initial center-of-mass of the rigid-body to create.
       * @param principalAngularInertia − The initial principal angular inertia of the rigid-body to create.
       *                                  These are the eigenvalues of the angular inertia matrix.
       * @param angularInertiaLocalFrame − The initial local angular inertia frame of the rigid-body to create.
       *                                   These are the eigenvectors of the angular inertia matrix.
       */
      setAdditionalMassProperties(mass, centerOfMass, principalAngularInertia, angularInertiaLocalFrame) {
        this.mass = mass;
        VectorOps.copy(this.centerOfMass, centerOfMass);
        VectorOps.copy(this.principalAngularInertia, principalAngularInertia);
        RotationOps.copy(this.angularInertiaLocalFrame, angularInertiaLocalFrame);
        this.massOnly = false;
        return this;
      }
      /**
       * Allow translation of this rigid-body only along specific axes.
       * @param translationsEnabledX - Are translations along the X axis enabled?
       * @param translationsEnabledY - Are translations along the y axis enabled?
       * @param translationsEnabledZ - Are translations along the Z axis enabled?
       */
      enabledTranslations(translationsEnabledX, translationsEnabledY, translationsEnabledZ) {
        this.translationsEnabledX = translationsEnabledX;
        this.translationsEnabledY = translationsEnabledY;
        this.translationsEnabledZ = translationsEnabledZ;
        return this;
      }
      /**
       * Allow translation of this rigid-body only along specific axes.
       * @param translationsEnabledX - Are translations along the X axis enabled?
       * @param translationsEnabledY - Are translations along the y axis enabled?
       * @param translationsEnabledZ - Are translations along the Z axis enabled?
       * @deprecated use `this.enabledTranslations` with the same arguments instead.
       */
      restrictTranslations(translationsEnabledX, translationsEnabledY, translationsEnabledZ) {
        return this.enabledTranslations(translationsEnabledX, translationsEnabledY, translationsEnabledZ);
      }
      /**
       * Locks all translations that would have resulted from forces on
       * the created rigid-body.
       */
      lockTranslations() {
        return this.enabledTranslations(false, false, false);
      }
      /**
       * Allow rotation of this rigid-body only along specific axes.
       * @param rotationsEnabledX - Are rotations along the X axis enabled?
       * @param rotationsEnabledY - Are rotations along the y axis enabled?
       * @param rotationsEnabledZ - Are rotations along the Z axis enabled?
       */
      enabledRotations(rotationsEnabledX, rotationsEnabledY, rotationsEnabledZ) {
        this.rotationsEnabledX = rotationsEnabledX;
        this.rotationsEnabledY = rotationsEnabledY;
        this.rotationsEnabledZ = rotationsEnabledZ;
        return this;
      }
      /**
       * Allow rotation of this rigid-body only along specific axes.
       * @param rotationsEnabledX - Are rotations along the X axis enabled?
       * @param rotationsEnabledY - Are rotations along the y axis enabled?
       * @param rotationsEnabledZ - Are rotations along the Z axis enabled?
       * @deprecated use `this.enabledRotations` with the same arguments instead.
       */
      restrictRotations(rotationsEnabledX, rotationsEnabledY, rotationsEnabledZ) {
        return this.enabledRotations(rotationsEnabledX, rotationsEnabledY, rotationsEnabledZ);
      }
      /**
       * Locks all rotations that would have resulted from forces on
       * the created rigid-body.
       */
      lockRotations() {
        return this.restrictRotations(false, false, false);
      }
      // #endif
      /**
       * Sets the linear damping of the rigid-body to create.
       *
       * This will progressively slowdown the translational movement of the rigid-body.
       *
       * @param damping - The angular damping coefficient. Should be >= 0. The higher this
       *                  value is, the stronger the translational slowdown will be.
       */
      setLinearDamping(damping) {
        this.linearDamping = damping;
        return this;
      }
      /**
       * Sets the angular damping of the rigid-body to create.
       *
       * This will progressively slowdown the rotational movement of the rigid-body.
       *
       * @param damping - The angular damping coefficient. Should be >= 0. The higher this
       *                  value is, the stronger the rotational slowdown will be.
       */
      setAngularDamping(damping) {
        this.angularDamping = damping;
        return this;
      }
      /**
       * Sets whether or not the rigid-body to create can sleep.
       *
       * @param can - true if the rigid-body can sleep, false if it can't.
       */
      setCanSleep(can) {
        this.canSleep = can;
        return this;
      }
      /**
       * Sets whether or not the rigid-body is to be created asleep.
       *
       * @param can - true if the rigid-body should be in sleep, default false.
       */
      setSleeping(sleeping) {
        this.sleeping = sleeping;
        return this;
      }
      /**
       * Sets whether Continuous Collision Detection (CCD) is enabled for this rigid-body.
       *
       * @param enabled - true if the rigid-body has CCD enabled.
       */
      setCcdEnabled(enabled) {
        this.ccdEnabled = enabled;
        return this;
      }
      /**
       * Sets the maximum prediction distance Soft Continuous Collision-Detection.
       *
       * When set to 0, soft-CCD is disabled. Soft-CCD helps prevent tunneling especially of
       * slow-but-thin to moderately fast objects. The soft CCD prediction distance indicates how
       * far in the object’s path the CCD algorithm is allowed to inspect. Large values can impact
       * performance badly by increasing the work needed from the broad-phase.
       *
       * It is a generally cheaper variant of regular CCD (that can be enabled with
       * `RigidBodyDesc::setCcdEnabled` since it relies on predictive constraints instead of
       * shape-cast and substeps.
       */
      setSoftCcdPrediction(distance) {
        this.softCcdPrediction = distance;
        return this;
      }
      /**
       * Sets the user-defined object of this rigid-body.
       *
       * @param userData - The user-defined object to set.
       */
      setUserData(data) {
        this.userData = data;
        return this;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/coarena.js
var Coarena;
var init_coarena = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/coarena.js"() {
    Coarena = class {
      constructor() {
        this.fconv = new Float64Array(1);
        this.uconv = new Uint32Array(this.fconv.buffer);
        this.data = new Array();
        this.size = 0;
      }
      set(handle, data) {
        let i = this.index(handle);
        while (this.data.length <= i) {
          this.data.push(null);
        }
        if (this.data[i] == null)
          this.size += 1;
        this.data[i] = data;
      }
      len() {
        return this.size;
      }
      delete(handle) {
        let i = this.index(handle);
        if (i < this.data.length) {
          if (this.data[i] != null)
            this.size -= 1;
          this.data[i] = null;
        }
      }
      clear() {
        this.data = new Array();
      }
      get(handle) {
        let i = this.index(handle);
        if (i < this.data.length) {
          return this.data[i];
        } else {
          return null;
        }
      }
      forEach(f) {
        for (const elt of this.data) {
          if (elt != null)
            f(elt);
        }
      }
      getAll() {
        return this.data.filter((elt) => elt != null);
      }
      index(handle) {
        this.fconv[0] = handle;
        return this.uconv[0];
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/rigid_body_set.js
var RigidBodySet;
var init_rigid_body_set = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/rigid_body_set.js"() {
    init_raw();
    init_coarena();
    init_math();
    init_rigid_body();
    RigidBodySet = class {
      constructor(raw) {
        this.raw = raw || new RawRigidBodySet();
        this.map = new Coarena();
        if (raw) {
          raw.forEachRigidBodyHandle((handle) => {
            this.map.set(handle, new RigidBody(raw, null, handle));
          });
        }
      }
      /**
       * Release the WASM memory occupied by this rigid-body set.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
        if (!!this.map) {
          this.map.clear();
        }
        this.map = void 0;
      }
      /**
       * Internal method, do not call this explicitly.
       */
      finalizeDeserialization(colliderSet) {
        this.map.forEach((rb) => rb.finalizeDeserialization(colliderSet));
      }
      /**
       * Creates a new rigid-body and return its integer handle.
       *
       * @param desc - The description of the rigid-body to create.
       */
      createRigidBody(colliderSet, desc) {
        let rawTra = VectorOps.intoRaw(desc.translation);
        let rawRot = RotationOps.intoRaw(desc.rotation);
        let rawLv = VectorOps.intoRaw(desc.linvel);
        let rawCom = VectorOps.intoRaw(desc.centerOfMass);
        let rawAv = VectorOps.intoRaw(desc.angvel);
        let rawPrincipalInertia = VectorOps.intoRaw(desc.principalAngularInertia);
        let rawInertiaFrame = RotationOps.intoRaw(desc.angularInertiaLocalFrame);
        let handle = this.raw.createRigidBody(
          desc.enabled,
          rawTra,
          rawRot,
          desc.gravityScale,
          desc.mass,
          desc.massOnly,
          rawCom,
          rawLv,
          // #if DIM3
          rawAv,
          rawPrincipalInertia,
          rawInertiaFrame,
          desc.translationsEnabledX,
          desc.translationsEnabledY,
          desc.translationsEnabledZ,
          desc.rotationsEnabledX,
          desc.rotationsEnabledY,
          desc.rotationsEnabledZ,
          // #endif
          desc.linearDamping,
          desc.angularDamping,
          desc.status,
          desc.canSleep,
          desc.sleeping,
          desc.softCcdPrediction,
          desc.ccdEnabled,
          desc.dominanceGroup,
          desc.additionalSolverIterations
        );
        rawTra.free();
        rawRot.free();
        rawLv.free();
        rawCom.free();
        rawAv.free();
        rawPrincipalInertia.free();
        rawInertiaFrame.free();
        const body = new RigidBody(this.raw, colliderSet, handle);
        body.userData = desc.userData;
        this.map.set(handle, body);
        return body;
      }
      /**
       * Removes a rigid-body from this set.
       *
       * This will also remove all the colliders and joints attached to the rigid-body.
       *
       * @param handle - The integer handle of the rigid-body to remove.
       * @param colliders - The set of colliders that may contain colliders attached to the removed rigid-body.
       * @param impulseJoints - The set of impulse joints that may contain joints attached to the removed rigid-body.
       * @param multibodyJoints - The set of multibody joints that may contain joints attached to the removed rigid-body.
       */
      remove(handle, islands, colliders, impulseJoints, multibodyJoints) {
        for (let i = 0; i < this.raw.rbNumColliders(handle); i += 1) {
          colliders.unmap(this.raw.rbCollider(handle, i));
        }
        impulseJoints.forEachJointHandleAttachedToRigidBody(handle, (handle2) => impulseJoints.unmap(handle2));
        multibodyJoints.forEachJointHandleAttachedToRigidBody(handle, (handle2) => multibodyJoints.unmap(handle2));
        this.raw.remove(handle, islands.raw, colliders.raw, impulseJoints.raw, multibodyJoints.raw);
        this.map.delete(handle);
      }
      /**
       * The number of rigid-bodies on this set.
       */
      len() {
        return this.map.len();
      }
      /**
       * Does this set contain a rigid-body with the given handle?
       *
       * @param handle - The rigid-body handle to check.
       */
      contains(handle) {
        return this.get(handle) != null;
      }
      /**
       * Gets the rigid-body with the given handle.
       *
       * @param handle - The handle of the rigid-body to retrieve.
       */
      get(handle) {
        return this.map.get(handle);
      }
      /**
       * Applies the given closure to each rigid-body contained by this set.
       *
       * @param f - The closure to apply.
       */
      forEach(f) {
        this.map.forEach(f);
      }
      /**
       * Applies the given closure to each active rigid-bodies contained by this set.
       *
       * A rigid-body is active if it is not sleeping, i.e., if it moved recently.
       *
       * @param f - The closure to apply.
       */
      forEachActiveRigidBody(islands, f) {
        islands.forEachActiveRigidBodyHandle((handle) => {
          f(this.get(handle));
        });
      }
      /**
       * Gets all rigid-bodies in the list.
       *
       * @returns rigid-bodies list.
       */
      getAll() {
        return this.map.getAll();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/integration_parameters.js
var IntegrationParameters;
var init_integration_parameters = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/integration_parameters.js"() {
    init_raw();
    IntegrationParameters = class {
      constructor(raw) {
        this.raw = raw || new RawIntegrationParameters();
      }
      /**
       * Free the WASM memory used by these integration parameters.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * The timestep length (default: `1.0 / 60.0`)
       */
      get dt() {
        return this.raw.dt;
      }
      /**
       * The Error Reduction Parameter in `[0, 1]` is the proportion of
       * the positional error to be corrected at each time step (default: `0.2`).
       */
      get contact_erp() {
        return this.raw.contact_erp;
      }
      get lengthUnit() {
        return this.raw.lengthUnit;
      }
      /**
       * Normalized amount of penetration the engine won’t attempt to correct (default: `0.001m`).
       *
       * This threshold considered by the physics engine is this value multiplied by the `lengthUnit`.
       */
      get normalizedAllowedLinearError() {
        return this.raw.normalizedAllowedLinearError;
      }
      /**
       * The maximal normalized distance separating two objects that will generate predictive contacts (default: `0.002`).
       *
       * This threshold considered by the physics engine is this value multiplied by the `lengthUnit`.
       */
      get normalizedPredictionDistance() {
        return this.raw.normalizedPredictionDistance;
      }
      /**
       * The number of solver iterations run by the constraints solver for calculating forces (default: `4`).
       */
      get numSolverIterations() {
        return this.raw.numSolverIterations;
      }
      /**
       * Number of addition friction resolution iteration run during the last solver sub-step (default: `4`).
       */
      get numAdditionalFrictionIterations() {
        return this.raw.numAdditionalFrictionIterations;
      }
      /**
       * Number of internal Project Gauss Seidel (PGS) iterations run at each solver iteration (default: `1`).
       */
      get numInternalPgsIterations() {
        return this.raw.numInternalPgsIterations;
      }
      /**
       * Minimum number of dynamic bodies in each active island (default: `128`).
       */
      get minIslandSize() {
        return this.raw.minIslandSize;
      }
      /**
       * Maximum number of substeps performed by the  solver (default: `1`).
       */
      get maxCcdSubsteps() {
        return this.raw.maxCcdSubsteps;
      }
      set dt(value) {
        this.raw.dt = value;
      }
      set contact_natural_frequency(value) {
        this.raw.contact_natural_frequency = value;
      }
      set lengthUnit(value) {
        this.raw.lengthUnit = value;
      }
      set normalizedAllowedLinearError(value) {
        this.raw.normalizedAllowedLinearError = value;
      }
      set normalizedPredictionDistance(value) {
        this.raw.normalizedPredictionDistance = value;
      }
      /**
       * Sets the number of solver iterations run by the constraints solver for calculating forces (default: `4`).
       */
      set numSolverIterations(value) {
        this.raw.numSolverIterations = value;
      }
      /**
       * Sets the number of addition friction resolution iteration run during the last solver sub-step (default: `4`).
       */
      set numAdditionalFrictionIterations(value) {
        this.raw.numAdditionalFrictionIterations = value;
      }
      /**
       * Sets the number of internal Project Gauss Seidel (PGS) iterations run at each solver iteration (default: `1`).
       */
      set numInternalPgsIterations(value) {
        this.raw.numInternalPgsIterations = value;
      }
      set minIslandSize(value) {
        this.raw.minIslandSize = value;
      }
      set maxCcdSubsteps(value) {
        this.raw.maxCcdSubsteps = value;
      }
      switchToStandardPgsSolver() {
        this.raw.switchToStandardPgsSolver();
      }
      switchToSmallStepsPgsSolver() {
        this.raw.switchToSmallStepsPgsSolver();
      }
      switchToSmallStepsPgsSolverWithoutWarmstart() {
        this.raw.switchToSmallStepsPgsSolverWithoutWarmstart();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/impulse_joint.js
var JointType, MotorModel, JointAxesMask, ImpulseJoint, UnitImpulseJoint, FixedImpulseJoint, RopeImpulseJoint, SpringImpulseJoint, PrismaticImpulseJoint, RevoluteImpulseJoint, GenericImpulseJoint, SphericalImpulseJoint, JointData;
var init_impulse_joint = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/impulse_joint.js"() {
    init_math();
    init_raw();
    (function(JointType2) {
      JointType2[JointType2["Revolute"] = 0] = "Revolute";
      JointType2[JointType2["Fixed"] = 1] = "Fixed";
      JointType2[JointType2["Prismatic"] = 2] = "Prismatic";
      JointType2[JointType2["Rope"] = 3] = "Rope";
      JointType2[JointType2["Spring"] = 4] = "Spring";
      JointType2[JointType2["Spherical"] = 5] = "Spherical";
      JointType2[JointType2["Generic"] = 6] = "Generic";
    })(JointType || (JointType = {}));
    (function(MotorModel2) {
      MotorModel2[MotorModel2["AccelerationBased"] = 0] = "AccelerationBased";
      MotorModel2[MotorModel2["ForceBased"] = 1] = "ForceBased";
    })(MotorModel || (MotorModel = {}));
    (function(JointAxesMask2) {
      JointAxesMask2[JointAxesMask2["LinX"] = 1] = "LinX";
      JointAxesMask2[JointAxesMask2["LinY"] = 2] = "LinY";
      JointAxesMask2[JointAxesMask2["LinZ"] = 4] = "LinZ";
      JointAxesMask2[JointAxesMask2["AngX"] = 8] = "AngX";
      JointAxesMask2[JointAxesMask2["AngY"] = 16] = "AngY";
      JointAxesMask2[JointAxesMask2["AngZ"] = 32] = "AngZ";
    })(JointAxesMask || (JointAxesMask = {}));
    ImpulseJoint = class _ImpulseJoint {
      constructor(rawSet, bodySet, handle) {
        this.rawSet = rawSet;
        this.bodySet = bodySet;
        this.handle = handle;
      }
      static newTyped(rawSet, bodySet, handle) {
        switch (rawSet.jointType(handle)) {
          case RawJointType.Revolute:
            return new RevoluteImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Prismatic:
            return new PrismaticImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Fixed:
            return new FixedImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Spring:
            return new SpringImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Rope:
            return new RopeImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Spherical:
            return new SphericalImpulseJoint(rawSet, bodySet, handle);
          case RawJointType.Generic:
            return new GenericImpulseJoint(rawSet, bodySet, handle);
          default:
            return new _ImpulseJoint(rawSet, bodySet, handle);
        }
      }
      /** @internal */
      finalizeDeserialization(bodySet) {
        this.bodySet = bodySet;
      }
      /**
       * Checks if this joint is still valid (i.e. that it has
       * not been deleted from the joint set yet).
       */
      isValid() {
        return this.rawSet.contains(this.handle);
      }
      /**
       * The first rigid-body this joint it attached to.
       */
      body1() {
        return this.bodySet.get(this.rawSet.jointBodyHandle1(this.handle));
      }
      /**
       * The second rigid-body this joint is attached to.
       */
      body2() {
        return this.bodySet.get(this.rawSet.jointBodyHandle2(this.handle));
      }
      /**
       * The type of this joint given as a string.
       */
      type() {
        return this.rawSet.jointType(this.handle);
      }
      // #if DIM3
      /**
       * The rotation quaternion that aligns this joint's first local axis to the `x` axis.
       */
      frameX1() {
        return RotationOps.fromRaw(this.rawSet.jointFrameX1(this.handle));
      }
      // #endif
      // #if DIM3
      /**
       * The rotation matrix that aligns this joint's second local axis to the `x` axis.
       */
      frameX2() {
        return RotationOps.fromRaw(this.rawSet.jointFrameX2(this.handle));
      }
      // #endif
      /**
       * The position of the first anchor of this joint.
       *
       * The first anchor gives the position of the application point on the
       * local frame of the first rigid-body it is attached to.
       */
      anchor1() {
        return VectorOps.fromRaw(this.rawSet.jointAnchor1(this.handle));
      }
      /**
       * The position of the second anchor of this joint.
       *
       * The second anchor gives the position of the application point on the
       * local frame of the second rigid-body it is attached to.
       */
      anchor2() {
        return VectorOps.fromRaw(this.rawSet.jointAnchor2(this.handle));
      }
      /**
       * Sets the position of the first anchor of this joint.
       *
       * The first anchor gives the position of the application point on the
       * local frame of the first rigid-body it is attached to.
       */
      setAnchor1(newPos) {
        const rawPoint = VectorOps.intoRaw(newPos);
        this.rawSet.jointSetAnchor1(this.handle, rawPoint);
        rawPoint.free();
      }
      /**
       * Sets the position of the second anchor of this joint.
       *
       * The second anchor gives the position of the application point on the
       * local frame of the second rigid-body it is attached to.
       */
      setAnchor2(newPos) {
        const rawPoint = VectorOps.intoRaw(newPos);
        this.rawSet.jointSetAnchor2(this.handle, rawPoint);
        rawPoint.free();
      }
      /**
       * Controls whether contacts are computed between colliders attached
       * to the rigid-bodies linked by this joint.
       */
      setContactsEnabled(enabled) {
        this.rawSet.jointSetContactsEnabled(this.handle, enabled);
      }
      /**
       * Indicates if contacts are enabled between colliders attached
       * to the rigid-bodies linked by this joint.
       */
      contactsEnabled() {
        return this.rawSet.jointContactsEnabled(this.handle);
      }
    };
    UnitImpulseJoint = class extends ImpulseJoint {
      /**
       * Are the limits enabled for this joint?
       */
      limitsEnabled() {
        return this.rawSet.jointLimitsEnabled(this.handle, this.rawAxis());
      }
      /**
       * The min limit of this joint.
       */
      limitsMin() {
        return this.rawSet.jointLimitsMin(this.handle, this.rawAxis());
      }
      /**
       * The max limit of this joint.
       */
      limitsMax() {
        return this.rawSet.jointLimitsMax(this.handle, this.rawAxis());
      }
      /**
       * Sets the limits of this joint.
       *
       * @param min - The minimum bound of this joint’s free coordinate.
       * @param max - The maximum bound of this joint’s free coordinate.
       */
      setLimits(min, max) {
        this.rawSet.jointSetLimits(this.handle, this.rawAxis(), min, max);
      }
      configureMotorModel(model) {
        this.rawSet.jointConfigureMotorModel(this.handle, this.rawAxis(), model);
      }
      configureMotorVelocity(targetVel, factor) {
        this.rawSet.jointConfigureMotorVelocity(this.handle, this.rawAxis(), targetVel, factor);
      }
      configureMotorPosition(targetPos, stiffness, damping) {
        this.rawSet.jointConfigureMotorPosition(this.handle, this.rawAxis(), targetPos, stiffness, damping);
      }
      configureMotor(targetPos, targetVel, stiffness, damping) {
        this.rawSet.jointConfigureMotor(this.handle, this.rawAxis(), targetPos, targetVel, stiffness, damping);
      }
    };
    FixedImpulseJoint = class extends ImpulseJoint {
    };
    RopeImpulseJoint = class extends ImpulseJoint {
    };
    SpringImpulseJoint = class extends ImpulseJoint {
    };
    PrismaticImpulseJoint = class extends UnitImpulseJoint {
      rawAxis() {
        return RawJointAxis.LinX;
      }
    };
    RevoluteImpulseJoint = class extends UnitImpulseJoint {
      rawAxis() {
        return RawJointAxis.AngX;
      }
    };
    GenericImpulseJoint = class extends ImpulseJoint {
    };
    SphericalImpulseJoint = class extends ImpulseJoint {
    };
    JointData = class _JointData {
      constructor() {
      }
      /**
       * Creates a new joint descriptor that builds a Fixed joint.
       *
       * A fixed joint removes all the degrees of freedom between the affected bodies, ensuring their
       * anchor and local frames coincide in world-space.
       *
       * @param anchor1 - Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param frame1 - The reference orientation of the joint wrt. the first rigid-body.
       * @param anchor2 - Point where the joint is attached on the second rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param frame2 - The reference orientation of the joint wrt. the second rigid-body.
       */
      static fixed(anchor1, frame1, anchor2, frame2) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.frame1 = frame1;
        res.frame2 = frame2;
        res.jointType = JointType.Fixed;
        return res;
      }
      static spring(rest_length, stiffness, damping, anchor1, anchor2) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.length = rest_length;
        res.stiffness = stiffness;
        res.damping = damping;
        res.jointType = JointType.Spring;
        return res;
      }
      static rope(length, anchor1, anchor2) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.length = length;
        res.jointType = JointType.Rope;
        return res;
      }
      // #if DIM3
      /**
       * Create a new joint descriptor that builds generic joints.
       *
       * A generic joint allows customizing its degrees of freedom
       * by supplying a mask of the joint axes that should remain locked.
       *
       * @param anchor1 - Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param anchor2 - Point where the joint is attached on the second rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param axis - The X axis of the joint, expressed in the local-space of the rigid-bodies it is attached to.
       * @param axesMask - Mask representing the locked axes of the joint. You can use logical OR to select these from
       *                   the JointAxesMask enum. For example, passing (JointAxesMask.AngX || JointAxesMask.AngY) will
       *                   create a joint locked in the X and Y rotational axes.
       */
      static generic(anchor1, anchor2, axis, axesMask) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.axis = axis;
        res.axesMask = axesMask;
        res.jointType = JointType.Generic;
        return res;
      }
      /**
       * Create a new joint descriptor that builds spherical joints.
       *
       * A spherical joint allows three relative rotational degrees of freedom
       * by preventing any relative translation between the anchors of the
       * two attached rigid-bodies.
       *
       * @param anchor1 - Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param anchor2 - Point where the joint is attached on the second rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       */
      static spherical(anchor1, anchor2) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.jointType = JointType.Spherical;
        return res;
      }
      /**
       * Creates a new joint descriptor that builds a Prismatic joint.
       *
       * A prismatic joint removes all the degrees of freedom between the
       * affected bodies, except for the translation along one axis.
       *
       * @param anchor1 - Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param anchor2 - Point where the joint is attached on the second rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param axis - Axis of the joint, expressed in the local-space of the rigid-bodies it is attached to.
       */
      static prismatic(anchor1, anchor2, axis) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.axis = axis;
        res.jointType = JointType.Prismatic;
        return res;
      }
      /**
       * Create a new joint descriptor that builds Revolute joints.
       *
       * A revolute joint removes all degrees of freedom between the affected
       * bodies except for the rotation along one axis.
       *
       * @param anchor1 - Point where the joint is attached on the first rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param anchor2 - Point where the joint is attached on the second rigid-body affected by this joint. Expressed in the
       *                  local-space of the rigid-body.
       * @param axis - Axis of the joint, expressed in the local-space of the rigid-bodies it is attached to.
       */
      static revolute(anchor1, anchor2, axis) {
        let res = new _JointData();
        res.anchor1 = anchor1;
        res.anchor2 = anchor2;
        res.axis = axis;
        res.jointType = JointType.Revolute;
        return res;
      }
      // #endif
      intoRaw() {
        let rawA1 = VectorOps.intoRaw(this.anchor1);
        let rawA2 = VectorOps.intoRaw(this.anchor2);
        let rawAx;
        let result;
        let limitsEnabled = false;
        let limitsMin = 0;
        let limitsMax = 0;
        switch (this.jointType) {
          case JointType.Fixed:
            let rawFra1 = RotationOps.intoRaw(this.frame1);
            let rawFra2 = RotationOps.intoRaw(this.frame2);
            result = RawGenericJoint.fixed(rawA1, rawFra1, rawA2, rawFra2);
            rawFra1.free();
            rawFra2.free();
            break;
          case JointType.Spring:
            result = RawGenericJoint.spring(this.length, this.stiffness, this.damping, rawA1, rawA2);
            break;
          case JointType.Rope:
            result = RawGenericJoint.rope(this.length, rawA1, rawA2);
            break;
          case JointType.Prismatic:
            rawAx = VectorOps.intoRaw(this.axis);
            if (!!this.limitsEnabled) {
              limitsEnabled = true;
              limitsMin = this.limits[0];
              limitsMax = this.limits[1];
            }
            result = RawGenericJoint.prismatic(rawA1, rawA2, rawAx, limitsEnabled, limitsMin, limitsMax);
            rawAx.free();
            break;
          case JointType.Generic:
            rawAx = VectorOps.intoRaw(this.axis);
            let rawAxesMask = this.axesMask;
            result = RawGenericJoint.generic(rawA1, rawA2, rawAx, rawAxesMask);
            break;
          case JointType.Spherical:
            result = RawGenericJoint.spherical(rawA1, rawA2);
            break;
          case JointType.Revolute:
            rawAx = VectorOps.intoRaw(this.axis);
            result = RawGenericJoint.revolute(rawA1, rawA2, rawAx);
            rawAx.free();
            break;
        }
        rawA1.free();
        rawA2.free();
        return result;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/impulse_joint_set.js
var ImpulseJointSet;
var init_impulse_joint_set = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/impulse_joint_set.js"() {
    init_raw();
    init_coarena();
    init_impulse_joint();
    ImpulseJointSet = class {
      constructor(raw) {
        this.raw = raw || new RawImpulseJointSet();
        this.map = new Coarena();
        if (raw) {
          raw.forEachJointHandle((handle) => {
            this.map.set(handle, ImpulseJoint.newTyped(raw, null, handle));
          });
        }
      }
      /**
       * Release the WASM memory occupied by this joint set.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
        if (!!this.map) {
          this.map.clear();
        }
        this.map = void 0;
      }
      /** @internal */
      finalizeDeserialization(bodies) {
        this.map.forEach((joint) => joint.finalizeDeserialization(bodies));
      }
      /**
       * Creates a new joint and return its integer handle.
       *
       * @param bodies - The set of rigid-bodies containing the bodies the joint is attached to.
       * @param desc - The joint's parameters.
       * @param parent1 - The handle of the first rigid-body this joint is attached to.
       * @param parent2 - The handle of the second rigid-body this joint is attached to.
       * @param wakeUp - Should the attached rigid-bodies be awakened?
       */
      createJoint(bodies, desc, parent1, parent2, wakeUp) {
        const rawParams = desc.intoRaw();
        const handle = this.raw.createJoint(rawParams, parent1, parent2, wakeUp);
        rawParams.free();
        let joint = ImpulseJoint.newTyped(this.raw, bodies, handle);
        this.map.set(handle, joint);
        return joint;
      }
      /**
       * Remove a joint from this set.
       *
       * @param handle - The integer handle of the joint.
       * @param wakeUp - If `true`, the rigid-bodies attached by the removed joint will be woken-up automatically.
       */
      remove(handle, wakeUp) {
        this.raw.remove(handle, wakeUp);
        this.unmap(handle);
      }
      /**
       * Calls the given closure with the integer handle of each impulse joint attached to this rigid-body.
       *
       * @param f - The closure called with the integer handle of each impulse joint attached to the rigid-body.
       */
      forEachJointHandleAttachedToRigidBody(handle, f) {
        this.raw.forEachJointAttachedToRigidBody(handle, f);
      }
      /**
       * Internal function, do not call directly.
       * @param handle
       */
      unmap(handle) {
        this.map.delete(handle);
      }
      /**
       * The number of joints on this set.
       */
      len() {
        return this.map.len();
      }
      /**
       * Does this set contain a joint with the given handle?
       *
       * @param handle - The joint handle to check.
       */
      contains(handle) {
        return this.get(handle) != null;
      }
      /**
       * Gets the joint with the given handle.
       *
       * Returns `null` if no joint with the specified handle exists.
       *
       * @param handle - The integer handle of the joint to retrieve.
       */
      get(handle) {
        return this.map.get(handle);
      }
      /**
       * Applies the given closure to each joint contained by this set.
       *
       * @param f - The closure to apply.
       */
      forEach(f) {
        this.map.forEach(f);
      }
      /**
       * Gets all joints in the list.
       *
       * @returns joint list.
       */
      getAll() {
        return this.map.getAll();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/multibody_joint.js
var MultibodyJoint, UnitMultibodyJoint, FixedMultibodyJoint, PrismaticMultibodyJoint, RevoluteMultibodyJoint, SphericalMultibodyJoint;
var init_multibody_joint = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/multibody_joint.js"() {
    init_raw();
    MultibodyJoint = class _MultibodyJoint {
      constructor(rawSet, handle) {
        this.rawSet = rawSet;
        this.handle = handle;
      }
      static newTyped(rawSet, handle) {
        switch (rawSet.jointType(handle)) {
          case RawJointType.Revolute:
            return new RevoluteMultibodyJoint(rawSet, handle);
          case RawJointType.Prismatic:
            return new PrismaticMultibodyJoint(rawSet, handle);
          case RawJointType.Fixed:
            return new FixedMultibodyJoint(rawSet, handle);
          case RawJointType.Spherical:
            return new SphericalMultibodyJoint(rawSet, handle);
          default:
            return new _MultibodyJoint(rawSet, handle);
        }
      }
      /**
       * Checks if this joint is still valid (i.e. that it has
       * not been deleted from the joint set yet).
       */
      isValid() {
        return this.rawSet.contains(this.handle);
      }
      // /**
      //  * The unique integer identifier of the first rigid-body this joint it attached to.
      //  */
      // public bodyHandle1(): RigidBodyHandle {
      //     return this.rawSet.jointBodyHandle1(this.handle);
      // }
      //
      // /**
      //  * The unique integer identifier of the second rigid-body this joint is attached to.
      //  */
      // public bodyHandle2(): RigidBodyHandle {
      //     return this.rawSet.jointBodyHandle2(this.handle);
      // }
      //
      // /**
      //  * The type of this joint given as a string.
      //  */
      // public type(): JointType {
      //     return this.rawSet.jointType(this.handle);
      // }
      //
      // // #if DIM3
      // /**
      //  * The rotation quaternion that aligns this joint's first local axis to the `x` axis.
      //  */
      // public frameX1(): Rotation {
      //     return RotationOps.fromRaw(this.rawSet.jointFrameX1(this.handle));
      // }
      //
      // // #endif
      //
      // // #if DIM3
      // /**
      //  * The rotation matrix that aligns this joint's second local axis to the `x` axis.
      //  */
      // public frameX2(): Rotation {
      //     return RotationOps.fromRaw(this.rawSet.jointFrameX2(this.handle));
      // }
      //
      // // #endif
      //
      // /**
      //  * The position of the first anchor of this joint.
      //  *
      //  * The first anchor gives the position of the points application point on the
      //  * local frame of the first rigid-body it is attached to.
      //  */
      // public anchor1(): Vector {
      //     return VectorOps.fromRaw(this.rawSet.jointAnchor1(this.handle));
      // }
      //
      // /**
      //  * The position of the second anchor of this joint.
      //  *
      //  * The second anchor gives the position of the points application point on the
      //  * local frame of the second rigid-body it is attached to.
      //  */
      // public anchor2(): Vector {
      //     return VectorOps.fromRaw(this.rawSet.jointAnchor2(this.handle));
      // }
      /**
       * Controls whether contacts are computed between colliders attached
       * to the rigid-bodies linked by this joint.
       */
      setContactsEnabled(enabled) {
        this.rawSet.jointSetContactsEnabled(this.handle, enabled);
      }
      /**
       * Indicates if contacts are enabled between colliders attached
       * to the rigid-bodies linked by this joint.
       */
      contactsEnabled() {
        return this.rawSet.jointContactsEnabled(this.handle);
      }
    };
    UnitMultibodyJoint = class extends MultibodyJoint {
    };
    FixedMultibodyJoint = class extends MultibodyJoint {
    };
    PrismaticMultibodyJoint = class extends UnitMultibodyJoint {
      rawAxis() {
        return RawJointAxis.LinX;
      }
    };
    RevoluteMultibodyJoint = class extends UnitMultibodyJoint {
      rawAxis() {
        return RawJointAxis.AngX;
      }
    };
    SphericalMultibodyJoint = class extends MultibodyJoint {
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/multibody_joint_set.js
var MultibodyJointSet;
var init_multibody_joint_set = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/multibody_joint_set.js"() {
    init_raw();
    init_coarena();
    init_multibody_joint();
    MultibodyJointSet = class {
      constructor(raw) {
        this.raw = raw || new RawMultibodyJointSet();
        this.map = new Coarena();
        if (raw) {
          raw.forEachJointHandle((handle) => {
            this.map.set(handle, MultibodyJoint.newTyped(this.raw, handle));
          });
        }
      }
      /**
       * Release the WASM memory occupied by this joint set.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
        if (!!this.map) {
          this.map.clear();
        }
        this.map = void 0;
      }
      /**
       * Creates a new joint and return its integer handle.
       *
       * @param desc - The joint's parameters.
       * @param parent1 - The handle of the first rigid-body this joint is attached to.
       * @param parent2 - The handle of the second rigid-body this joint is attached to.
       * @param wakeUp - Should the attached rigid-bodies be awakened?
       */
      createJoint(desc, parent1, parent2, wakeUp) {
        const rawParams = desc.intoRaw();
        const handle = this.raw.createJoint(rawParams, parent1, parent2, wakeUp);
        rawParams.free();
        let joint = MultibodyJoint.newTyped(this.raw, handle);
        this.map.set(handle, joint);
        return joint;
      }
      /**
       * Remove a joint from this set.
       *
       * @param handle - The integer handle of the joint.
       * @param wake_up - If `true`, the rigid-bodies attached by the removed joint will be woken-up automatically.
       */
      remove(handle, wake_up) {
        this.raw.remove(handle, wake_up);
        this.map.delete(handle);
      }
      /**
       * Internal function, do not call directly.
       * @param handle
       */
      unmap(handle) {
        this.map.delete(handle);
      }
      /**
       * The number of joints on this set.
       */
      len() {
        return this.map.len();
      }
      /**
       * Does this set contain a joint with the given handle?
       *
       * @param handle - The joint handle to check.
       */
      contains(handle) {
        return this.get(handle) != null;
      }
      /**
       * Gets the joint with the given handle.
       *
       * Returns `null` if no joint with the specified handle exists.
       *
       * @param handle - The integer handle of the joint to retrieve.
       */
      get(handle) {
        return this.map.get(handle);
      }
      /**
       * Applies the given closure to each joint contained by this set.
       *
       * @param f - The closure to apply.
       */
      forEach(f) {
        this.map.forEach(f);
      }
      /**
       * Calls the given closure with the integer handle of each multibody joint attached to this rigid-body.
       *
       * @param f - The closure called with the integer handle of each multibody joint attached to the rigid-body.
       */
      forEachJointHandleAttachedToRigidBody(handle, f) {
        this.raw.forEachJointAttachedToRigidBody(handle, f);
      }
      /**
       * Gets all joints in the list.
       *
       * @returns joint list.
       */
      getAll() {
        return this.map.getAll();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/coefficient_combine_rule.js
var CoefficientCombineRule;
var init_coefficient_combine_rule = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/coefficient_combine_rule.js"() {
    (function(CoefficientCombineRule2) {
      CoefficientCombineRule2[CoefficientCombineRule2["Average"] = 0] = "Average";
      CoefficientCombineRule2[CoefficientCombineRule2["Min"] = 1] = "Min";
      CoefficientCombineRule2[CoefficientCombineRule2["Multiply"] = 2] = "Multiply";
      CoefficientCombineRule2[CoefficientCombineRule2["Max"] = 3] = "Max";
    })(CoefficientCombineRule || (CoefficientCombineRule = {}));
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/ccd_solver.js
var CCDSolver;
var init_ccd_solver = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/ccd_solver.js"() {
    init_raw();
    CCDSolver = class {
      constructor(raw) {
        this.raw = raw || new RawCCDSolver();
      }
      /**
       * Release the WASM memory occupied by this narrow-phase.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/island_manager.js
var IslandManager;
var init_island_manager = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/island_manager.js"() {
    init_raw();
    IslandManager = class {
      constructor(raw) {
        this.raw = raw || new RawIslandManager();
      }
      /**
       * Release the WASM memory occupied by this narrow-phase.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Applies the given closure to the handle of each active rigid-bodies contained by this set.
       *
       * A rigid-body is active if it is not sleeping, i.e., if it moved recently.
       *
       * @param f - The closure to apply.
       */
      forEachActiveRigidBodyHandle(f) {
        this.raw.forEachActiveRigidBodyHandle(f);
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/dynamics/index.js
var init_dynamics = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/dynamics/index.js"() {
    init_rigid_body();
    init_rigid_body_set();
    init_integration_parameters();
    init_impulse_joint();
    init_impulse_joint_set();
    init_multibody_joint();
    init_multibody_joint_set();
    init_coefficient_combine_rule();
    init_ccd_solver();
    init_island_manager();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/broad_phase.js
var BroadPhase;
var init_broad_phase = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/broad_phase.js"() {
    init_raw();
    BroadPhase = class {
      constructor(raw) {
        this.raw = raw || new RawBroadPhase();
      }
      /**
       * Release the WASM memory occupied by this broad-phase.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/narrow_phase.js
var NarrowPhase, TempContactManifold;
var init_narrow_phase = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/narrow_phase.js"() {
    init_raw();
    init_math();
    NarrowPhase = class {
      constructor(raw) {
        this.raw = raw || new RawNarrowPhase();
        this.tempManifold = new TempContactManifold(null);
      }
      /**
       * Release the WASM memory occupied by this narrow-phase.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Enumerates all the colliders potentially in contact with the given collider.
       *
       * @param collider1 - The second collider involved in the contact.
       * @param f - Closure that will be called on each collider that is in contact with `collider1`.
       */
      contactPairsWith(collider1, f) {
        this.raw.contact_pairs_with(collider1, f);
      }
      /**
       * Enumerates all the colliders intersecting the given colliders, assuming one of them
       * is a sensor.
       */
      intersectionPairsWith(collider1, f) {
        this.raw.intersection_pairs_with(collider1, f);
      }
      /**
       * Iterates through all the contact manifolds between the given pair of colliders.
       *
       * @param collider1 - The first collider involved in the contact.
       * @param collider2 - The second collider involved in the contact.
       * @param f - Closure that will be called on each contact manifold between the two colliders. If the second argument
       *            passed to this closure is `true`, then the contact manifold data is flipped, i.e., methods like `localNormal1`
       *            actually apply to the `collider2` and fields like `localNormal2` apply to the `collider1`.
       */
      contactPair(collider1, collider2, f) {
        const rawPair = this.raw.contact_pair(collider1, collider2);
        if (!!rawPair) {
          const flipped = rawPair.collider1() != collider1;
          let i;
          for (i = 0; i < rawPair.numContactManifolds(); ++i) {
            this.tempManifold.raw = rawPair.contactManifold(i);
            if (!!this.tempManifold.raw) {
              f(this.tempManifold, flipped);
            }
            this.tempManifold.free();
          }
          rawPair.free();
        }
      }
      /**
       * Returns `true` if `collider1` and `collider2` intersect and at least one of them is a sensor.
       * @param collider1 − The first collider involved in the intersection.
       * @param collider2 − The second collider involved in the intersection.
       */
      intersectionPair(collider1, collider2) {
        return this.raw.intersection_pair(collider1, collider2);
      }
    };
    TempContactManifold = class {
      constructor(raw) {
        this.raw = raw;
      }
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      normal() {
        return VectorOps.fromRaw(this.raw.normal());
      }
      localNormal1() {
        return VectorOps.fromRaw(this.raw.local_n1());
      }
      localNormal2() {
        return VectorOps.fromRaw(this.raw.local_n2());
      }
      subshape1() {
        return this.raw.subshape1();
      }
      subshape2() {
        return this.raw.subshape2();
      }
      numContacts() {
        return this.raw.num_contacts();
      }
      localContactPoint1(i) {
        return VectorOps.fromRaw(this.raw.contact_local_p1(i));
      }
      localContactPoint2(i) {
        return VectorOps.fromRaw(this.raw.contact_local_p2(i));
      }
      contactDist(i) {
        return this.raw.contact_dist(i);
      }
      contactFid1(i) {
        return this.raw.contact_fid1(i);
      }
      contactFid2(i) {
        return this.raw.contact_fid2(i);
      }
      contactImpulse(i) {
        return this.raw.contact_impulse(i);
      }
      // #if DIM3
      contactTangentImpulseX(i) {
        return this.raw.contact_tangent_impulse_x(i);
      }
      contactTangentImpulseY(i) {
        return this.raw.contact_tangent_impulse_y(i);
      }
      // #endif
      numSolverContacts() {
        return this.raw.num_solver_contacts();
      }
      solverContactPoint(i) {
        return VectorOps.fromRaw(this.raw.solver_contact_point(i));
      }
      solverContactDist(i) {
        return this.raw.solver_contact_dist(i);
      }
      solverContactFriction(i) {
        return this.raw.solver_contact_friction(i);
      }
      solverContactRestitution(i) {
        return this.raw.solver_contact_restitution(i);
      }
      solverContactTangentVelocity(i) {
        return VectorOps.fromRaw(this.raw.solver_contact_tangent_velocity(i));
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/contact.js
var ShapeContact;
var init_contact = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/contact.js"() {
    init_math();
    ShapeContact = class _ShapeContact {
      constructor(dist, point1, point2, normal1, normal2) {
        this.distance = dist;
        this.point1 = point1;
        this.point2 = point2;
        this.normal1 = normal1;
        this.normal2 = normal2;
      }
      static fromRaw(raw) {
        if (!raw)
          return null;
        const result = new _ShapeContact(raw.distance(), VectorOps.fromRaw(raw.point1()), VectorOps.fromRaw(raw.point2()), VectorOps.fromRaw(raw.normal1()), VectorOps.fromRaw(raw.normal2()));
        raw.free();
        return result;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/feature.js
var FeatureType;
var init_feature = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/feature.js"() {
    (function(FeatureType2) {
      FeatureType2[FeatureType2["Vertex"] = 0] = "Vertex";
      FeatureType2[FeatureType2["Edge"] = 1] = "Edge";
      FeatureType2[FeatureType2["Face"] = 2] = "Face";
      FeatureType2[FeatureType2["Unknown"] = 3] = "Unknown";
    })(FeatureType || (FeatureType = {}));
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/point.js
var PointProjection, PointColliderProjection;
var init_point = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/point.js"() {
    init_math();
    init_feature();
    PointProjection = class _PointProjection {
      constructor(point, isInside) {
        this.point = point;
        this.isInside = isInside;
      }
      static fromRaw(raw) {
        if (!raw)
          return null;
        const result = new _PointProjection(VectorOps.fromRaw(raw.point()), raw.isInside());
        raw.free();
        return result;
      }
    };
    PointColliderProjection = class _PointColliderProjection {
      constructor(collider, point, isInside, featureType, featureId) {
        this.featureType = FeatureType.Unknown;
        this.featureId = void 0;
        this.collider = collider;
        this.point = point;
        this.isInside = isInside;
        if (featureId !== void 0)
          this.featureId = featureId;
        if (featureType !== void 0)
          this.featureType = featureType;
      }
      static fromRaw(colliderSet, raw) {
        if (!raw)
          return null;
        const result = new _PointColliderProjection(colliderSet.get(raw.colliderHandle()), VectorOps.fromRaw(raw.point()), raw.isInside(), raw.featureType(), raw.featureId());
        raw.free();
        return result;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/ray.js
var Ray, RayIntersection, RayColliderIntersection, RayColliderHit;
var init_ray = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/ray.js"() {
    init_math();
    init_feature();
    Ray = class {
      /**
       * Builds a ray from its origin and direction.
       *
       * @param origin - The ray's starting point.
       * @param dir - The ray's direction of propagation.
       */
      constructor(origin, dir) {
        this.origin = origin;
        this.dir = dir;
      }
      pointAt(t) {
        return {
          x: this.origin.x + this.dir.x * t,
          y: this.origin.y + this.dir.y * t,
          // #if DIM3
          z: this.origin.z + this.dir.z * t
          // #endif
        };
      }
    };
    RayIntersection = class _RayIntersection {
      constructor(timeOfImpact, normal, featureType, featureId) {
        this.featureType = FeatureType.Unknown;
        this.featureId = void 0;
        this.timeOfImpact = timeOfImpact;
        this.normal = normal;
        if (featureId !== void 0)
          this.featureId = featureId;
        if (featureType !== void 0)
          this.featureType = featureType;
      }
      static fromRaw(raw) {
        if (!raw)
          return null;
        const result = new _RayIntersection(raw.time_of_impact(), VectorOps.fromRaw(raw.normal()), raw.featureType(), raw.featureId());
        raw.free();
        return result;
      }
    };
    RayColliderIntersection = class _RayColliderIntersection {
      constructor(collider, timeOfImpact, normal, featureType, featureId) {
        this.featureType = FeatureType.Unknown;
        this.featureId = void 0;
        this.collider = collider;
        this.timeOfImpact = timeOfImpact;
        this.normal = normal;
        if (featureId !== void 0)
          this.featureId = featureId;
        if (featureType !== void 0)
          this.featureType = featureType;
      }
      static fromRaw(colliderSet, raw) {
        if (!raw)
          return null;
        const result = new _RayColliderIntersection(colliderSet.get(raw.colliderHandle()), raw.time_of_impact(), VectorOps.fromRaw(raw.normal()), raw.featureType(), raw.featureId());
        raw.free();
        return result;
      }
    };
    RayColliderHit = class _RayColliderHit {
      constructor(collider, timeOfImpact) {
        this.collider = collider;
        this.timeOfImpact = timeOfImpact;
      }
      static fromRaw(colliderSet, raw) {
        if (!raw)
          return null;
        const result = new _RayColliderHit(colliderSet.get(raw.colliderHandle()), raw.timeOfImpact());
        raw.free();
        return result;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/toi.js
var ShapeCastHit, ColliderShapeCastHit;
var init_toi = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/toi.js"() {
    init_math();
    ShapeCastHit = class _ShapeCastHit {
      constructor(time_of_impact, witness1, witness2, normal1, normal2) {
        this.time_of_impact = time_of_impact;
        this.witness1 = witness1;
        this.witness2 = witness2;
        this.normal1 = normal1;
        this.normal2 = normal2;
      }
      static fromRaw(colliderSet, raw) {
        if (!raw)
          return null;
        const result = new _ShapeCastHit(raw.time_of_impact(), VectorOps.fromRaw(raw.witness1()), VectorOps.fromRaw(raw.witness2()), VectorOps.fromRaw(raw.normal1()), VectorOps.fromRaw(raw.normal2()));
        raw.free();
        return result;
      }
    };
    ColliderShapeCastHit = class _ColliderShapeCastHit extends ShapeCastHit {
      constructor(collider, time_of_impact, witness1, witness2, normal1, normal2) {
        super(time_of_impact, witness1, witness2, normal1, normal2);
        this.collider = collider;
      }
      static fromRaw(colliderSet, raw) {
        if (!raw)
          return null;
        const result = new _ColliderShapeCastHit(colliderSet.get(raw.colliderHandle()), raw.time_of_impact(), VectorOps.fromRaw(raw.witness1()), VectorOps.fromRaw(raw.witness2()), VectorOps.fromRaw(raw.normal1()), VectorOps.fromRaw(raw.normal2()));
        raw.free();
        return result;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/shape.js
var Shape, ShapeType, HeightFieldFlags, TriMeshFlags, Ball, HalfSpace, Cuboid, RoundCuboid, Capsule, Segment, Triangle, RoundTriangle, Polyline, TriMesh, ConvexPolyhedron, RoundConvexPolyhedron, Heightfield, Cylinder, RoundCylinder, Cone, RoundCone;
var init_shape = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/shape.js"() {
    init_math();
    init_raw();
    init_contact();
    init_point();
    init_ray();
    init_toi();
    Shape = class {
      /**
       * instant mode without cache
       */
      static fromRaw(rawSet, handle) {
        const rawType = rawSet.coShapeType(handle);
        let extents;
        let borderRadius;
        let vs;
        let indices;
        let halfHeight;
        let radius;
        let normal;
        switch (rawType) {
          case RawShapeType.Ball:
            return new Ball(rawSet.coRadius(handle));
          case RawShapeType.Cuboid:
            extents = rawSet.coHalfExtents(handle);
            return new Cuboid(extents.x, extents.y, extents.z);
          case RawShapeType.RoundCuboid:
            extents = rawSet.coHalfExtents(handle);
            borderRadius = rawSet.coRoundRadius(handle);
            return new RoundCuboid(extents.x, extents.y, extents.z, borderRadius);
          case RawShapeType.Capsule:
            halfHeight = rawSet.coHalfHeight(handle);
            radius = rawSet.coRadius(handle);
            return new Capsule(halfHeight, radius);
          case RawShapeType.Segment:
            vs = rawSet.coVertices(handle);
            return new Segment(VectorOps.new(vs[0], vs[1], vs[2]), VectorOps.new(vs[3], vs[4], vs[5]));
          case RawShapeType.Polyline:
            vs = rawSet.coVertices(handle);
            indices = rawSet.coIndices(handle);
            return new Polyline(vs, indices);
          case RawShapeType.Triangle:
            vs = rawSet.coVertices(handle);
            return new Triangle(VectorOps.new(vs[0], vs[1], vs[2]), VectorOps.new(vs[3], vs[4], vs[5]), VectorOps.new(vs[6], vs[7], vs[8]));
          case RawShapeType.RoundTriangle:
            vs = rawSet.coVertices(handle);
            borderRadius = rawSet.coRoundRadius(handle);
            return new RoundTriangle(VectorOps.new(vs[0], vs[1], vs[2]), VectorOps.new(vs[3], vs[4], vs[5]), VectorOps.new(vs[6], vs[7], vs[8]), borderRadius);
          case RawShapeType.HalfSpace:
            normal = VectorOps.fromRaw(rawSet.coHalfspaceNormal(handle));
            return new HalfSpace(normal);
          case RawShapeType.TriMesh:
            vs = rawSet.coVertices(handle);
            indices = rawSet.coIndices(handle);
            const tri_flags = rawSet.coTriMeshFlags(handle);
            return new TriMesh(vs, indices, tri_flags);
          case RawShapeType.HeightField:
            const scale = rawSet.coHeightfieldScale(handle);
            const heights = rawSet.coHeightfieldHeights(handle);
            const nrows = rawSet.coHeightfieldNRows(handle);
            const ncols = rawSet.coHeightfieldNCols(handle);
            const hf_flags = rawSet.coHeightFieldFlags(handle);
            return new Heightfield(nrows, ncols, heights, scale, hf_flags);
          case RawShapeType.ConvexPolyhedron:
            vs = rawSet.coVertices(handle);
            indices = rawSet.coIndices(handle);
            return new ConvexPolyhedron(vs, indices);
          case RawShapeType.RoundConvexPolyhedron:
            vs = rawSet.coVertices(handle);
            indices = rawSet.coIndices(handle);
            borderRadius = rawSet.coRoundRadius(handle);
            return new RoundConvexPolyhedron(vs, indices, borderRadius);
          case RawShapeType.Cylinder:
            halfHeight = rawSet.coHalfHeight(handle);
            radius = rawSet.coRadius(handle);
            return new Cylinder(halfHeight, radius);
          case RawShapeType.RoundCylinder:
            halfHeight = rawSet.coHalfHeight(handle);
            radius = rawSet.coRadius(handle);
            borderRadius = rawSet.coRoundRadius(handle);
            return new RoundCylinder(halfHeight, radius, borderRadius);
          case RawShapeType.Cone:
            halfHeight = rawSet.coHalfHeight(handle);
            radius = rawSet.coRadius(handle);
            return new Cone(halfHeight, radius);
          case RawShapeType.RoundCone:
            halfHeight = rawSet.coHalfHeight(handle);
            radius = rawSet.coRadius(handle);
            borderRadius = rawSet.coRoundRadius(handle);
            return new RoundCone(halfHeight, radius, borderRadius);
          default:
            throw new Error("unknown shape type: " + rawType);
        }
      }
      /**
       * Computes the time of impact between two moving shapes.
       * @param shapePos1 - The initial position of this sahpe.
       * @param shapeRot1 - The rotation of this shape.
       * @param shapeVel1 - The velocity of this shape.
       * @param shape2 - The second moving shape.
       * @param shapePos2 - The initial position of the second shape.
       * @param shapeRot2 - The rotation of the second shape.
       * @param shapeVel2 - The velocity of the second shape.
       * @param targetDistance − If the shape moves closer to this distance from a collider, a hit
       *                         will be returned.
       * @param maxToi - The maximum time when the impact can happen.
       * @param stopAtPenetration - If set to `false`, the linear shape-cast won’t immediately stop if
       *   the shape is penetrating another shape at its starting point **and** its trajectory is such
       *   that it’s on a path to exit that penetration state.
       * @returns If the two moving shapes collider at some point along their trajectories, this returns the
       *  time at which the two shape collider as well as the contact information during the impact. Returns
       *  `null`if the two shapes never collide along their paths.
       */
      castShape(shapePos1, shapeRot1, shapeVel1, shape2, shapePos2, shapeRot2, shapeVel2, targetDistance, maxToi, stopAtPenetration) {
        let rawPos1 = VectorOps.intoRaw(shapePos1);
        let rawRot1 = RotationOps.intoRaw(shapeRot1);
        let rawVel1 = VectorOps.intoRaw(shapeVel1);
        let rawPos2 = VectorOps.intoRaw(shapePos2);
        let rawRot2 = RotationOps.intoRaw(shapeRot2);
        let rawVel2 = VectorOps.intoRaw(shapeVel2);
        let rawShape1 = this.intoRaw();
        let rawShape2 = shape2.intoRaw();
        let result = ShapeCastHit.fromRaw(null, rawShape1.castShape(rawPos1, rawRot1, rawVel1, rawShape2, rawPos2, rawRot2, rawVel2, targetDistance, maxToi, stopAtPenetration));
        rawPos1.free();
        rawRot1.free();
        rawVel1.free();
        rawPos2.free();
        rawRot2.free();
        rawVel2.free();
        rawShape1.free();
        rawShape2.free();
        return result;
      }
      /**
       * Tests if this shape intersects another shape.
       *
       * @param shapePos1 - The position of this shape.
       * @param shapeRot1 - The rotation of this shape.
       * @param shape2  - The second shape to test.
       * @param shapePos2 - The position of the second shape.
       * @param shapeRot2 - The rotation of the second shape.
       * @returns `true` if the two shapes intersect, `false` if they don’t.
       */
      intersectsShape(shapePos1, shapeRot1, shape2, shapePos2, shapeRot2) {
        let rawPos1 = VectorOps.intoRaw(shapePos1);
        let rawRot1 = RotationOps.intoRaw(shapeRot1);
        let rawPos2 = VectorOps.intoRaw(shapePos2);
        let rawRot2 = RotationOps.intoRaw(shapeRot2);
        let rawShape1 = this.intoRaw();
        let rawShape2 = shape2.intoRaw();
        let result = rawShape1.intersectsShape(rawPos1, rawRot1, rawShape2, rawPos2, rawRot2);
        rawPos1.free();
        rawRot1.free();
        rawPos2.free();
        rawRot2.free();
        rawShape1.free();
        rawShape2.free();
        return result;
      }
      /**
       * Computes one pair of contact points between two shapes.
       *
       * @param shapePos1 - The initial position of this sahpe.
       * @param shapeRot1 - The rotation of this shape.
       * @param shape2 - The second shape.
       * @param shapePos2 - The initial position of the second shape.
       * @param shapeRot2 - The rotation of the second shape.
       * @param prediction - The prediction value, if the shapes are separated by a distance greater than this value, test will fail.
       * @returns `null` if the shapes are separated by a distance greater than prediction, otherwise contact details. The result is given in world-space.
       */
      contactShape(shapePos1, shapeRot1, shape2, shapePos2, shapeRot2, prediction) {
        let rawPos1 = VectorOps.intoRaw(shapePos1);
        let rawRot1 = RotationOps.intoRaw(shapeRot1);
        let rawPos2 = VectorOps.intoRaw(shapePos2);
        let rawRot2 = RotationOps.intoRaw(shapeRot2);
        let rawShape1 = this.intoRaw();
        let rawShape2 = shape2.intoRaw();
        let result = ShapeContact.fromRaw(rawShape1.contactShape(rawPos1, rawRot1, rawShape2, rawPos2, rawRot2, prediction));
        rawPos1.free();
        rawRot1.free();
        rawPos2.free();
        rawRot2.free();
        rawShape1.free();
        rawShape2.free();
        return result;
      }
      containsPoint(shapePos, shapeRot, point) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawPoint = VectorOps.intoRaw(point);
        let rawShape = this.intoRaw();
        let result = rawShape.containsPoint(rawPos, rawRot, rawPoint);
        rawPos.free();
        rawRot.free();
        rawPoint.free();
        rawShape.free();
        return result;
      }
      projectPoint(shapePos, shapeRot, point, solid) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawPoint = VectorOps.intoRaw(point);
        let rawShape = this.intoRaw();
        let result = PointProjection.fromRaw(rawShape.projectPoint(rawPos, rawRot, rawPoint, solid));
        rawPos.free();
        rawRot.free();
        rawPoint.free();
        rawShape.free();
        return result;
      }
      intersectsRay(ray, shapePos, shapeRot, maxToi) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawRayOrig = VectorOps.intoRaw(ray.origin);
        let rawRayDir = VectorOps.intoRaw(ray.dir);
        let rawShape = this.intoRaw();
        let result = rawShape.intersectsRay(rawPos, rawRot, rawRayOrig, rawRayDir, maxToi);
        rawPos.free();
        rawRot.free();
        rawRayOrig.free();
        rawRayDir.free();
        rawShape.free();
        return result;
      }
      castRay(ray, shapePos, shapeRot, maxToi, solid) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawRayOrig = VectorOps.intoRaw(ray.origin);
        let rawRayDir = VectorOps.intoRaw(ray.dir);
        let rawShape = this.intoRaw();
        let result = rawShape.castRay(rawPos, rawRot, rawRayOrig, rawRayDir, maxToi, solid);
        rawPos.free();
        rawRot.free();
        rawRayOrig.free();
        rawRayDir.free();
        rawShape.free();
        return result;
      }
      castRayAndGetNormal(ray, shapePos, shapeRot, maxToi, solid) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawRayOrig = VectorOps.intoRaw(ray.origin);
        let rawRayDir = VectorOps.intoRaw(ray.dir);
        let rawShape = this.intoRaw();
        let result = RayIntersection.fromRaw(rawShape.castRayAndGetNormal(rawPos, rawRot, rawRayOrig, rawRayDir, maxToi, solid));
        rawPos.free();
        rawRot.free();
        rawRayOrig.free();
        rawRayDir.free();
        rawShape.free();
        return result;
      }
    };
    (function(ShapeType2) {
      ShapeType2[ShapeType2["Ball"] = 0] = "Ball";
      ShapeType2[ShapeType2["Cuboid"] = 1] = "Cuboid";
      ShapeType2[ShapeType2["Capsule"] = 2] = "Capsule";
      ShapeType2[ShapeType2["Segment"] = 3] = "Segment";
      ShapeType2[ShapeType2["Polyline"] = 4] = "Polyline";
      ShapeType2[ShapeType2["Triangle"] = 5] = "Triangle";
      ShapeType2[ShapeType2["TriMesh"] = 6] = "TriMesh";
      ShapeType2[ShapeType2["HeightField"] = 7] = "HeightField";
      ShapeType2[ShapeType2["ConvexPolyhedron"] = 9] = "ConvexPolyhedron";
      ShapeType2[ShapeType2["Cylinder"] = 10] = "Cylinder";
      ShapeType2[ShapeType2["Cone"] = 11] = "Cone";
      ShapeType2[ShapeType2["RoundCuboid"] = 12] = "RoundCuboid";
      ShapeType2[ShapeType2["RoundTriangle"] = 13] = "RoundTriangle";
      ShapeType2[ShapeType2["RoundCylinder"] = 14] = "RoundCylinder";
      ShapeType2[ShapeType2["RoundCone"] = 15] = "RoundCone";
      ShapeType2[ShapeType2["RoundConvexPolyhedron"] = 16] = "RoundConvexPolyhedron";
      ShapeType2[ShapeType2["HalfSpace"] = 17] = "HalfSpace";
    })(ShapeType || (ShapeType = {}));
    (function(HeightFieldFlags2) {
      HeightFieldFlags2[HeightFieldFlags2["FIX_INTERNAL_EDGES"] = 1] = "FIX_INTERNAL_EDGES";
    })(HeightFieldFlags || (HeightFieldFlags = {}));
    (function(TriMeshFlags2) {
      TriMeshFlags2[TriMeshFlags2["DELETE_BAD_TOPOLOGY_TRIANGLES"] = 4] = "DELETE_BAD_TOPOLOGY_TRIANGLES";
      TriMeshFlags2[TriMeshFlags2["ORIENTED"] = 8] = "ORIENTED";
      TriMeshFlags2[TriMeshFlags2["MERGE_DUPLICATE_VERTICES"] = 16] = "MERGE_DUPLICATE_VERTICES";
      TriMeshFlags2[TriMeshFlags2["DELETE_DEGENERATE_TRIANGLES"] = 32] = "DELETE_DEGENERATE_TRIANGLES";
      TriMeshFlags2[TriMeshFlags2["DELETE_DUPLICATE_TRIANGLES"] = 64] = "DELETE_DUPLICATE_TRIANGLES";
      TriMeshFlags2[TriMeshFlags2["FIX_INTERNAL_EDGES"] = 152] = "FIX_INTERNAL_EDGES";
    })(TriMeshFlags || (TriMeshFlags = {}));
    Ball = class extends Shape {
      /**
       * Creates a new ball with the given radius.
       * @param radius - The balls radius.
       */
      constructor(radius) {
        super();
        this.type = ShapeType.Ball;
        this.radius = radius;
      }
      intoRaw() {
        return RawShape.ball(this.radius);
      }
    };
    HalfSpace = class extends Shape {
      /**
       * Creates a new halfspace delimited by an infinite plane.
       *
       * @param normal - The outward normal of the plane.
       */
      constructor(normal) {
        super();
        this.type = ShapeType.HalfSpace;
        this.normal = normal;
      }
      intoRaw() {
        let n = VectorOps.intoRaw(this.normal);
        let result = RawShape.halfspace(n);
        n.free();
        return result;
      }
    };
    Cuboid = class extends Shape {
      // #if DIM3
      /**
       * Creates a new 3D cuboid.
       * @param hx - The half width of the cuboid.
       * @param hy - The half height of the cuboid.
       * @param hz - The half depth of the cuboid.
       */
      constructor(hx, hy, hz) {
        super();
        this.type = ShapeType.Cuboid;
        this.halfExtents = VectorOps.new(hx, hy, hz);
      }
      // #endif
      intoRaw() {
        return RawShape.cuboid(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z);
      }
    };
    RoundCuboid = class extends Shape {
      // #if DIM3
      /**
       * Creates a new 3D cuboid.
       * @param hx - The half width of the cuboid.
       * @param hy - The half height of the cuboid.
       * @param hz - The half depth of the cuboid.
       * @param borderRadius - The radius of the borders of this cuboid. This will
       *   effectively increase the half-extents of the cuboid by this radius.
       */
      constructor(hx, hy, hz, borderRadius) {
        super();
        this.type = ShapeType.RoundCuboid;
        this.halfExtents = VectorOps.new(hx, hy, hz);
        this.borderRadius = borderRadius;
      }
      // #endif
      intoRaw() {
        return RawShape.roundCuboid(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z, this.borderRadius);
      }
    };
    Capsule = class extends Shape {
      /**
       * Creates a new capsule with the given radius and half-height.
       * @param halfHeight - The balls half-height along the `y` axis.
       * @param radius - The balls radius.
       */
      constructor(halfHeight, radius) {
        super();
        this.type = ShapeType.Capsule;
        this.halfHeight = halfHeight;
        this.radius = radius;
      }
      intoRaw() {
        return RawShape.capsule(this.halfHeight, this.radius);
      }
    };
    Segment = class extends Shape {
      /**
       * Creates a new segment shape.
       * @param a - The first point of the segment.
       * @param b - The second point of the segment.
       */
      constructor(a, b) {
        super();
        this.type = ShapeType.Segment;
        this.a = a;
        this.b = b;
      }
      intoRaw() {
        let ra = VectorOps.intoRaw(this.a);
        let rb = VectorOps.intoRaw(this.b);
        let result = RawShape.segment(ra, rb);
        ra.free();
        rb.free();
        return result;
      }
    };
    Triangle = class extends Shape {
      /**
       * Creates a new triangle shape.
       *
       * @param a - The first point of the triangle.
       * @param b - The second point of the triangle.
       * @param c - The third point of the triangle.
       */
      constructor(a, b, c) {
        super();
        this.type = ShapeType.Triangle;
        this.a = a;
        this.b = b;
        this.c = c;
      }
      intoRaw() {
        let ra = VectorOps.intoRaw(this.a);
        let rb = VectorOps.intoRaw(this.b);
        let rc = VectorOps.intoRaw(this.c);
        let result = RawShape.triangle(ra, rb, rc);
        ra.free();
        rb.free();
        rc.free();
        return result;
      }
    };
    RoundTriangle = class extends Shape {
      /**
       * Creates a new triangle shape with round corners.
       *
       * @param a - The first point of the triangle.
       * @param b - The second point of the triangle.
       * @param c - The third point of the triangle.
       * @param borderRadius - The radius of the borders of this triangle. In 3D,
       *   this is also equal to half the thickness of the triangle.
       */
      constructor(a, b, c, borderRadius) {
        super();
        this.type = ShapeType.RoundTriangle;
        this.a = a;
        this.b = b;
        this.c = c;
        this.borderRadius = borderRadius;
      }
      intoRaw() {
        let ra = VectorOps.intoRaw(this.a);
        let rb = VectorOps.intoRaw(this.b);
        let rc = VectorOps.intoRaw(this.c);
        let result = RawShape.roundTriangle(ra, rb, rc, this.borderRadius);
        ra.free();
        rb.free();
        rc.free();
        return result;
      }
    };
    Polyline = class extends Shape {
      /**
       * Creates a new polyline shape.
       *
       * @param vertices - The coordinates of the polyline's vertices.
       * @param indices - The indices of the polyline's segments. If this is `null` or not provided, then
       *    the vertices are assumed to form a line strip.
       */
      constructor(vertices, indices) {
        super();
        this.type = ShapeType.Polyline;
        this.vertices = vertices;
        this.indices = indices !== null && indices !== void 0 ? indices : new Uint32Array(0);
      }
      intoRaw() {
        return RawShape.polyline(this.vertices, this.indices);
      }
    };
    TriMesh = class extends Shape {
      /**
       * Creates a new triangle mesh shape.
       *
       * @param vertices - The coordinates of the triangle mesh's vertices.
       * @param indices - The indices of the triangle mesh's triangles.
       */
      constructor(vertices, indices, flags) {
        super();
        this.type = ShapeType.TriMesh;
        this.vertices = vertices;
        this.indices = indices;
        this.flags = flags;
      }
      intoRaw() {
        return RawShape.trimesh(this.vertices, this.indices, this.flags);
      }
    };
    ConvexPolyhedron = class extends Shape {
      /**
       * Creates a new convex polygon shape.
       *
       * @param vertices - The coordinates of the convex polygon's vertices.
       * @param indices - The index buffer of this convex mesh. If this is `null`
       *   or `undefined`, the convex-hull of the input vertices will be computed
       *   automatically. Otherwise, it will be assumed that the mesh you provide
       *   is already convex.
       */
      constructor(vertices, indices) {
        super();
        this.type = ShapeType.ConvexPolyhedron;
        this.vertices = vertices;
        this.indices = indices;
      }
      intoRaw() {
        if (!!this.indices) {
          return RawShape.convexMesh(this.vertices, this.indices);
        } else {
          return RawShape.convexHull(this.vertices);
        }
      }
    };
    RoundConvexPolyhedron = class extends Shape {
      /**
       * Creates a new convex polygon shape.
       *
       * @param vertices - The coordinates of the convex polygon's vertices.
       * @param indices - The index buffer of this convex mesh. If this is `null`
       *   or `undefined`, the convex-hull of the input vertices will be computed
       *   automatically. Otherwise, it will be assumed that the mesh you provide
       *   is already convex.
       * @param borderRadius - The radius of the borders of this convex polyhedron.
       */
      constructor(vertices, indices, borderRadius) {
        super();
        this.type = ShapeType.RoundConvexPolyhedron;
        this.vertices = vertices;
        this.indices = indices;
        this.borderRadius = borderRadius;
      }
      intoRaw() {
        if (!!this.indices) {
          return RawShape.roundConvexMesh(this.vertices, this.indices, this.borderRadius);
        } else {
          return RawShape.roundConvexHull(this.vertices, this.borderRadius);
        }
      }
    };
    Heightfield = class extends Shape {
      /**
       * Creates a new heightfield shape.
       *
       * @param nrows − The number of rows in the heights matrix.
       * @param ncols - The number of columns in the heights matrix.
       * @param heights - The heights of the heightfield along its local `y` axis,
       *                  provided as a matrix stored in column-major order.
       * @param scale - The dimensions of the heightfield's local `x,z` plane.
       */
      constructor(nrows, ncols, heights, scale, flags) {
        super();
        this.type = ShapeType.HeightField;
        this.nrows = nrows;
        this.ncols = ncols;
        this.heights = heights;
        this.scale = scale;
        this.flags = flags;
      }
      intoRaw() {
        let rawScale = VectorOps.intoRaw(this.scale);
        let rawShape = RawShape.heightfield(this.nrows, this.ncols, this.heights, rawScale, this.flags);
        rawScale.free();
        return rawShape;
      }
    };
    Cylinder = class extends Shape {
      /**
       * Creates a new cylinder with the given radius and half-height.
       * @param halfHeight - The balls half-height along the `y` axis.
       * @param radius - The balls radius.
       */
      constructor(halfHeight, radius) {
        super();
        this.type = ShapeType.Cylinder;
        this.halfHeight = halfHeight;
        this.radius = radius;
      }
      intoRaw() {
        return RawShape.cylinder(this.halfHeight, this.radius);
      }
    };
    RoundCylinder = class extends Shape {
      /**
       * Creates a new cylinder with the given radius and half-height.
       * @param halfHeight - The balls half-height along the `y` axis.
       * @param radius - The balls radius.
       * @param borderRadius - The radius of the borders of this cylinder.
       */
      constructor(halfHeight, radius, borderRadius) {
        super();
        this.type = ShapeType.RoundCylinder;
        this.borderRadius = borderRadius;
        this.halfHeight = halfHeight;
        this.radius = radius;
      }
      intoRaw() {
        return RawShape.roundCylinder(this.halfHeight, this.radius, this.borderRadius);
      }
    };
    Cone = class extends Shape {
      /**
       * Creates a new cone with the given radius and half-height.
       * @param halfHeight - The balls half-height along the `y` axis.
       * @param radius - The balls radius.
       */
      constructor(halfHeight, radius) {
        super();
        this.type = ShapeType.Cone;
        this.halfHeight = halfHeight;
        this.radius = radius;
      }
      intoRaw() {
        return RawShape.cone(this.halfHeight, this.radius);
      }
    };
    RoundCone = class extends Shape {
      /**
       * Creates a new cone with the given radius and half-height.
       * @param halfHeight - The balls half-height along the `y` axis.
       * @param radius - The balls radius.
       * @param borderRadius - The radius of the borders of this cone.
       */
      constructor(halfHeight, radius, borderRadius) {
        super();
        this.type = ShapeType.RoundCone;
        this.halfHeight = halfHeight;
        this.radius = radius;
        this.borderRadius = borderRadius;
      }
      intoRaw() {
        return RawShape.roundCone(this.halfHeight, this.radius, this.borderRadius);
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/physics_pipeline.js
var PhysicsPipeline;
var init_physics_pipeline = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/physics_pipeline.js"() {
    init_raw();
    init_math();
    PhysicsPipeline = class {
      constructor(raw) {
        this.raw = raw || new RawPhysicsPipeline();
      }
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      step(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, impulseJoints, multibodyJoints, ccdSolver, eventQueue, hooks) {
        let rawG = VectorOps.intoRaw(gravity);
        if (!!eventQueue) {
          this.raw.stepWithEvents(rawG, integrationParameters.raw, islands.raw, broadPhase.raw, narrowPhase.raw, bodies.raw, colliders.raw, impulseJoints.raw, multibodyJoints.raw, ccdSolver.raw, eventQueue.raw, hooks, !!hooks ? hooks.filterContactPair : null, !!hooks ? hooks.filterIntersectionPair : null);
        } else {
          this.raw.step(rawG, integrationParameters.raw, islands.raw, broadPhase.raw, narrowPhase.raw, bodies.raw, colliders.raw, impulseJoints.raw, multibodyJoints.raw, ccdSolver.raw);
        }
        rawG.free();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/query_pipeline.js
var QueryFilterFlags, QueryPipeline;
var init_query_pipeline = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/query_pipeline.js"() {
    init_raw();
    init_geometry();
    init_math();
    (function(QueryFilterFlags2) {
      QueryFilterFlags2[QueryFilterFlags2["EXCLUDE_FIXED"] = 1] = "EXCLUDE_FIXED";
      QueryFilterFlags2[QueryFilterFlags2["EXCLUDE_KINEMATIC"] = 2] = "EXCLUDE_KINEMATIC";
      QueryFilterFlags2[QueryFilterFlags2["EXCLUDE_DYNAMIC"] = 4] = "EXCLUDE_DYNAMIC";
      QueryFilterFlags2[QueryFilterFlags2["EXCLUDE_SENSORS"] = 8] = "EXCLUDE_SENSORS";
      QueryFilterFlags2[QueryFilterFlags2["EXCLUDE_SOLIDS"] = 16] = "EXCLUDE_SOLIDS";
      QueryFilterFlags2[QueryFilterFlags2["ONLY_DYNAMIC"] = 3] = "ONLY_DYNAMIC";
      QueryFilterFlags2[QueryFilterFlags2["ONLY_KINEMATIC"] = 5] = "ONLY_KINEMATIC";
      QueryFilterFlags2[QueryFilterFlags2["ONLY_FIXED"] = 6] = "ONLY_FIXED";
    })(QueryFilterFlags || (QueryFilterFlags = {}));
    QueryPipeline = class {
      constructor(raw) {
        this.raw = raw || new RawQueryPipeline();
      }
      /**
       * Release the WASM memory occupied by this query pipeline.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Updates the acceleration structure of the query pipeline.
       * @param colliders - The set of colliders taking part in this pipeline.
       */
      update(colliders) {
        this.raw.update(colliders.raw);
      }
      /**
       * Find the closest intersection between a ray and a set of collider.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       * @param filter - The callback to filter out which collider will be hit.
       */
      castRay(bodies, colliders, ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let result = RayColliderHit.fromRaw(colliders, this.raw.castRay(bodies.raw, colliders.raw, rawOrig, rawDir, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate));
        rawOrig.free();
        rawDir.free();
        return result;
      }
      /**
       * Find the closest intersection between a ray and a set of collider.
       *
       * This also computes the normal at the hit point.
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       */
      castRayAndGetNormal(bodies, colliders, ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let result = RayColliderIntersection.fromRaw(colliders, this.raw.castRayAndGetNormal(bodies.raw, colliders.raw, rawOrig, rawDir, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate));
        rawOrig.free();
        rawDir.free();
        return result;
      }
      /**
       * Cast a ray and collects all the intersections between a ray and the scene.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       * @param callback - The callback called once per hit (in no particular order) between a ray and a collider.
       *   If this callback returns `false`, then the cast will stop and no further hits will be detected/reported.
       */
      intersectionsWithRay(bodies, colliders, ray, maxToi, solid, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let rawCallback = (rawInter) => {
          return callback(RayColliderIntersection.fromRaw(colliders, rawInter));
        };
        this.raw.intersectionsWithRay(bodies.raw, colliders.raw, rawOrig, rawDir, maxToi, solid, rawCallback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate);
        rawOrig.free();
        rawDir.free();
      }
      /**
       * Gets the handle of up to one collider intersecting the given shape.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param shapePos - The position of the shape used for the intersection test.
       * @param shapeRot - The orientation of the shape used for the intersection test.
       * @param shape - The shape used for the intersection test.
       * @param groups - The bit groups and filter associated to the ray, in order to only
       *   hit the colliders with collision groups compatible with the ray's group.
       */
      intersectionWithShape(bodies, colliders, shapePos, shapeRot, shape, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawShape = shape.intoRaw();
        let result = this.raw.intersectionWithShape(bodies.raw, colliders.raw, rawPos, rawRot, rawShape, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate);
        rawPos.free();
        rawRot.free();
        rawShape.free();
        return result;
      }
      /**
       * Find the projection of a point on the closest collider.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param point - The point to project.
       * @param solid - If this is set to `true` then the collider shapes are considered to
       *   be plain (if the point is located inside of a plain shape, its projection is the point
       *   itself). If it is set to `false` the collider shapes are considered to be hollow
       *   (if the point is located inside of an hollow shape, it is projected on the shape's
       *   boundary).
       * @param groups - The bit groups and filter associated to the point to project, in order to only
       *   project on colliders with collision groups compatible with the ray's group.
       */
      projectPoint(bodies, colliders, point, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPoint = VectorOps.intoRaw(point);
        let result = PointColliderProjection.fromRaw(colliders, this.raw.projectPoint(bodies.raw, colliders.raw, rawPoint, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate));
        rawPoint.free();
        return result;
      }
      /**
       * Find the projection of a point on the closest collider.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param point - The point to project.
       * @param groups - The bit groups and filter associated to the point to project, in order to only
       *   project on colliders with collision groups compatible with the ray's group.
       */
      projectPointAndGetFeature(bodies, colliders, point, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPoint = VectorOps.intoRaw(point);
        let result = PointColliderProjection.fromRaw(colliders, this.raw.projectPointAndGetFeature(bodies.raw, colliders.raw, rawPoint, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate));
        rawPoint.free();
        return result;
      }
      /**
       * Find all the colliders containing the given point.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param point - The point used for the containment test.
       * @param groups - The bit groups and filter associated to the point to test, in order to only
       *   test on colliders with collision groups compatible with the ray's group.
       * @param callback - A function called with the handles of each collider with a shape
       *   containing the `point`.
       */
      intersectionsWithPoint(bodies, colliders, point, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPoint = VectorOps.intoRaw(point);
        this.raw.intersectionsWithPoint(bodies.raw, colliders.raw, rawPoint, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate);
        rawPoint.free();
      }
      /**
       * Casts a shape at a constant linear velocity and retrieve the first collider it hits.
       * This is similar to ray-casting except that we are casting a whole shape instead of
       * just a point (the ray origin).
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param shapePos - The initial position of the shape to cast.
       * @param shapeRot - The initial rotation of the shape to cast.
       * @param shapeVel - The constant velocity of the shape to cast (i.e. the cast direction).
       * @param shape - The shape to cast.
       * @param targetDistance − If the shape moves closer to this distance from a collider, a hit
       *                       will be returned.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the distance traveled by the shape to `shapeVel.norm() * maxToi`.
       * @param stopAtPenetration - If set to `false`, the linear shape-cast won’t immediately stop if
       *   the shape is penetrating another shape at its starting point **and** its trajectory is such
       *   that it’s on a path to exit that penetration state.
       * @param groups - The bit groups and filter associated to the shape to cast, in order to only
       *   test on colliders with collision groups compatible with this group.
       */
      castShape(bodies, colliders, shapePos, shapeRot, shapeVel, shape, targetDistance, maxToi, stopAtPenetration, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawVel = VectorOps.intoRaw(shapeVel);
        let rawShape = shape.intoRaw();
        let result = ColliderShapeCastHit.fromRaw(colliders, this.raw.castShape(bodies.raw, colliders.raw, rawPos, rawRot, rawVel, rawShape, targetDistance, maxToi, stopAtPenetration, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate));
        rawPos.free();
        rawRot.free();
        rawVel.free();
        rawShape.free();
        return result;
      }
      /**
       * Retrieve all the colliders intersecting the given shape.
       *
       * @param colliders - The set of colliders taking part in this pipeline.
       * @param shapePos - The position of the shape to test.
       * @param shapeRot - The orientation of the shape to test.
       * @param shape - The shape to test.
       * @param groups - The bit groups and filter associated to the shape to test, in order to only
       *   test on colliders with collision groups compatible with this group.
       * @param callback - A function called with the handles of each collider intersecting the `shape`.
       */
      intersectionsWithShape(bodies, colliders, shapePos, shapeRot, shape, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let rawPos = VectorOps.intoRaw(shapePos);
        let rawRot = RotationOps.intoRaw(shapeRot);
        let rawShape = shape.intoRaw();
        this.raw.intersectionsWithShape(bodies.raw, colliders.raw, rawPos, rawRot, rawShape, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate);
        rawPos.free();
        rawRot.free();
        rawShape.free();
      }
      /**
       * Finds the handles of all the colliders with an AABB intersecting the given AABB.
       *
       * @param aabbCenter - The center of the AABB to test.
       * @param aabbHalfExtents - The half-extents of the AABB to test.
       * @param callback - The callback that will be called with the handles of all the colliders
       *                   currently intersecting the given AABB.
       */
      collidersWithAabbIntersectingAabb(aabbCenter, aabbHalfExtents, callback) {
        let rawCenter = VectorOps.intoRaw(aabbCenter);
        let rawHalfExtents = VectorOps.intoRaw(aabbHalfExtents);
        this.raw.collidersWithAabbIntersectingAabb(rawCenter, rawHalfExtents, callback);
        rawCenter.free();
        rawHalfExtents.free();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/serialization_pipeline.js
var SerializationPipeline;
var init_serialization_pipeline = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/serialization_pipeline.js"() {
    init_raw();
    init_math();
    init_world();
    SerializationPipeline = class {
      constructor(raw) {
        this.raw = raw || new RawSerializationPipeline();
      }
      /**
       * Release the WASM memory occupied by this serialization pipeline.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Serialize a complete physics state into a single byte array.
       * @param gravity - The current gravity affecting the simulation.
       * @param integrationParameters - The integration parameters of the simulation.
       * @param broadPhase - The broad-phase of the simulation.
       * @param narrowPhase - The narrow-phase of the simulation.
       * @param bodies - The rigid-bodies taking part into the simulation.
       * @param colliders - The colliders taking part into the simulation.
       * @param impulseJoints - The impulse joints taking part into the simulation.
       * @param multibodyJoints - The multibody joints taking part into the simulation.
       */
      serializeAll(gravity, integrationParameters, islands, broadPhase, narrowPhase, bodies, colliders, impulseJoints, multibodyJoints) {
        let rawGra = VectorOps.intoRaw(gravity);
        const res = this.raw.serializeAll(rawGra, integrationParameters.raw, islands.raw, broadPhase.raw, narrowPhase.raw, bodies.raw, colliders.raw, impulseJoints.raw, multibodyJoints.raw);
        rawGra.free();
        return res;
      }
      /**
       * Deserialize the complete physics state from a single byte array.
       *
       * @param data - The byte array to deserialize.
       */
      deserializeAll(data) {
        return World.fromRaw(this.raw.deserializeAll(data));
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/debug_render_pipeline.js
var DebugRenderBuffers, DebugRenderPipeline;
var init_debug_render_pipeline = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/debug_render_pipeline.js"() {
    init_raw();
    DebugRenderBuffers = class {
      constructor(vertices, colors) {
        this.vertices = vertices;
        this.colors = colors;
      }
    };
    DebugRenderPipeline = class {
      constructor(raw) {
        this.raw = raw || new RawDebugRenderPipeline();
      }
      /**
       * Release the WASM memory occupied by this serialization pipeline.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
        this.vertices = void 0;
        this.colors = void 0;
      }
      render(bodies, colliders, impulse_joints, multibody_joints, narrow_phase) {
        this.raw.render(bodies.raw, colliders.raw, impulse_joints.raw, multibody_joints.raw, narrow_phase.raw);
        this.vertices = this.raw.vertices();
        this.colors = this.raw.colors();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/control/character_controller.js
var CharacterCollision, KinematicCharacterController;
var init_character_controller = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/control/character_controller.js"() {
    init_raw();
    init_math();
    CharacterCollision = class {
    };
    KinematicCharacterController = class {
      constructor(offset, params, bodies, colliders, queries) {
        this.params = params;
        this.bodies = bodies;
        this.colliders = colliders;
        this.queries = queries;
        this.raw = new RawKinematicCharacterController(offset);
        this.rawCharacterCollision = new RawCharacterCollision();
        this._applyImpulsesToDynamicBodies = false;
        this._characterMass = null;
      }
      /** @internal */
      free() {
        if (!!this.raw) {
          this.raw.free();
          this.rawCharacterCollision.free();
        }
        this.raw = void 0;
        this.rawCharacterCollision = void 0;
      }
      /**
       * The direction that goes "up". Used to determine where the floor is, and the floor’s angle.
       */
      up() {
        return this.raw.up();
      }
      /**
       * Sets the direction that goes "up". Used to determine where the floor is, and the floor’s angle.
       */
      setUp(vector) {
        let rawVect = VectorOps.intoRaw(vector);
        return this.raw.setUp(rawVect);
        rawVect.free();
      }
      applyImpulsesToDynamicBodies() {
        return this._applyImpulsesToDynamicBodies;
      }
      setApplyImpulsesToDynamicBodies(enabled) {
        this._applyImpulsesToDynamicBodies = enabled;
      }
      /**
       * Returns the custom value of the character mass, if it was set by `this.setCharacterMass`.
       */
      characterMass() {
        return this._characterMass;
      }
      /**
       * Set the mass of the character to be used for impulse resolution if `self.applyImpulsesToDynamicBodies`
       * is set to `true`.
       *
       * If no character mass is set explicitly (or if it is set to `null`) it is automatically assumed to be equal
       * to the mass of the rigid-body the character collider is attached to; or equal to 0 if the character collider
       * isn’t attached to any rigid-body.
       *
       * @param mass - The mass to set.
       */
      setCharacterMass(mass) {
        this._characterMass = mass;
      }
      /**
       * A small gap to preserve between the character and its surroundings.
       *
       * This value should not be too large to avoid visual artifacts, but shouldn’t be too small
       * (must not be zero) to improve numerical stability of the character controller.
       */
      offset() {
        return this.raw.offset();
      }
      /**
       * Sets a small gap to preserve between the character and its surroundings.
       *
       * This value should not be too large to avoid visual artifacts, but shouldn’t be too small
       * (must not be zero) to improve numerical stability of the character controller.
       */
      setOffset(value) {
        this.raw.setOffset(value);
      }
      /// Increase this number if your character appears to get stuck when sliding against surfaces.
      ///
      /// This is a small distance applied to the movement toward the contact normals of shapes hit
      /// by the character controller. This helps shape-casting not getting stuck in an always-penetrating
      /// state during the sliding calculation.
      ///
      /// This value should remain fairly small since it can introduce artificial "bumps" when sliding
      /// along a flat surface.
      normalNudgeFactor() {
        return this.raw.normalNudgeFactor();
      }
      /// Increase this number if your character appears to get stuck when sliding against surfaces.
      ///
      /// This is a small distance applied to the movement toward the contact normals of shapes hit
      /// by the character controller. This helps shape-casting not getting stuck in an always-penetrating
      /// state during the sliding calculation.
      ///
      /// This value should remain fairly small since it can introduce artificial "bumps" when sliding
      /// along a flat surface.
      setNormalNudgeFactor(value) {
        this.raw.setNormalNudgeFactor(value);
      }
      /**
       * Is sliding against obstacles enabled?
       */
      slideEnabled() {
        return this.raw.slideEnabled();
      }
      /**
       * Enable or disable sliding against obstacles.
       */
      setSlideEnabled(enabled) {
        this.raw.setSlideEnabled(enabled);
      }
      /**
       * The maximum step height a character can automatically step over.
       */
      autostepMaxHeight() {
        return this.raw.autostepMaxHeight();
      }
      /**
       * The minimum width of free space that must be available after stepping on a stair.
       */
      autostepMinWidth() {
        return this.raw.autostepMinWidth();
      }
      /**
       * Can the character automatically step over dynamic bodies too?
       */
      autostepIncludesDynamicBodies() {
        return this.raw.autostepIncludesDynamicBodies();
      }
      /**
       * Is automatically stepping over small objects enabled?
       */
      autostepEnabled() {
        return this.raw.autostepEnabled();
      }
      /**
       * Enabled automatically stepping over small objects.
       *
       * @param maxHeight - The maximum step height a character can automatically step over.
       * @param minWidth - The minimum width of free space that must be available after stepping on a stair.
       * @param includeDynamicBodies - Can the character automatically step over dynamic bodies too?
       */
      enableAutostep(maxHeight, minWidth, includeDynamicBodies) {
        this.raw.enableAutostep(maxHeight, minWidth, includeDynamicBodies);
      }
      /**
       * Disable automatically stepping over small objects.
       */
      disableAutostep() {
        return this.raw.disableAutostep();
      }
      /**
       * The maximum angle (radians) between the floor’s normal and the `up` vector that the
       * character is able to climb.
       */
      maxSlopeClimbAngle() {
        return this.raw.maxSlopeClimbAngle();
      }
      /**
       * Sets the maximum angle (radians) between the floor’s normal and the `up` vector that the
       * character is able to climb.
       */
      setMaxSlopeClimbAngle(angle) {
        this.raw.setMaxSlopeClimbAngle(angle);
      }
      /**
       * The minimum angle (radians) between the floor’s normal and the `up` vector before the
       * character starts to slide down automatically.
       */
      minSlopeSlideAngle() {
        return this.raw.minSlopeSlideAngle();
      }
      /**
       * Sets the minimum angle (radians) between the floor’s normal and the `up` vector before the
       * character starts to slide down automatically.
       */
      setMinSlopeSlideAngle(angle) {
        this.raw.setMinSlopeSlideAngle(angle);
      }
      /**
       * If snap-to-ground is enabled, should the character be automatically snapped to the ground if
       * the distance between the ground and its feet are smaller than the specified threshold?
       */
      snapToGroundDistance() {
        return this.raw.snapToGroundDistance();
      }
      /**
       * Enables automatically snapping the character to the ground if the distance between
       * the ground and its feet are smaller than the specified threshold.
       */
      enableSnapToGround(distance) {
        this.raw.enableSnapToGround(distance);
      }
      /**
       * Disables automatically snapping the character to the ground.
       */
      disableSnapToGround() {
        this.raw.disableSnapToGround();
      }
      /**
       * Is automatically snapping the character to the ground enabled?
       */
      snapToGroundEnabled() {
        return this.raw.snapToGroundEnabled();
      }
      /**
       * Computes the movement the given collider is able to execute after hitting and sliding on obstacles.
       *
       * @param collider - The collider to move.
       * @param desiredTranslationDelta - The desired collider movement.
       * @param filterFlags - Flags for excluding whole subsets of colliders from the obstacles taken into account.
       * @param filterGroups - Groups for excluding colliders with incompatible collision groups from the obstacles
       *                       taken into account.
       * @param filterPredicate - Any collider for which this closure returns `false` will be excluded from the
       *                          obstacles taken into account.
       */
      computeColliderMovement(collider, desiredTranslationDelta, filterFlags, filterGroups, filterPredicate) {
        let rawTranslationDelta = VectorOps.intoRaw(desiredTranslationDelta);
        this.raw.computeColliderMovement(this.params.dt, this.bodies.raw, this.colliders.raw, this.queries.raw, collider.handle, rawTranslationDelta, this._applyImpulsesToDynamicBodies, this._characterMass, filterFlags, filterGroups, this.colliders.castClosure(filterPredicate));
        rawTranslationDelta.free();
      }
      /**
       * The movement computed by the last call to `this.computeColliderMovement`.
       */
      computedMovement() {
        return VectorOps.fromRaw(this.raw.computedMovement());
      }
      /**
       * The result of ground detection computed by the last call to `this.computeColliderMovement`.
       */
      computedGrounded() {
        return this.raw.computedGrounded();
      }
      /**
       * The number of collisions against obstacles detected along the path of the last call
       * to `this.computeColliderMovement`.
       */
      numComputedCollisions() {
        return this.raw.numComputedCollisions();
      }
      /**
       * Returns the collision against one of the obstacles detected along the path of the last
       * call to `this.computeColliderMovement`.
       *
       * @param i - The i-th collision will be returned.
       * @param out - If this argument is set, it will be filled with the collision information.
       */
      computedCollision(i, out) {
        if (!this.raw.computedCollision(i, this.rawCharacterCollision)) {
          return null;
        } else {
          let c = this.rawCharacterCollision;
          out = out !== null && out !== void 0 ? out : new CharacterCollision();
          out.translationDeltaApplied = VectorOps.fromRaw(c.translationDeltaApplied());
          out.translationDeltaRemaining = VectorOps.fromRaw(c.translationDeltaRemaining());
          out.toi = c.toi();
          out.witness1 = VectorOps.fromRaw(c.worldWitness1());
          out.witness2 = VectorOps.fromRaw(c.worldWitness2());
          out.normal1 = VectorOps.fromRaw(c.worldNormal1());
          out.normal2 = VectorOps.fromRaw(c.worldNormal2());
          out.collider = this.colliders.get(c.handle());
          return out;
        }
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/control/ray_cast_vehicle_controller.js
var DynamicRayCastVehicleController;
var init_ray_cast_vehicle_controller = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/control/ray_cast_vehicle_controller.js"() {
    init_raw();
    init_math();
    DynamicRayCastVehicleController = class {
      constructor(chassis, bodies, colliders, queries) {
        this.raw = new RawDynamicRayCastVehicleController(chassis.handle);
        this.bodies = bodies;
        this.colliders = colliders;
        this.queries = queries;
        this._chassis = chassis;
      }
      /** @internal */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Updates the vehicle’s velocity based on its suspension, engine force, and brake.
       *
       * This directly updates the velocity of its chassis rigid-body.
       *
       * @param dt - Time increment used to integrate forces.
       * @param filterFlags - Flag to exclude categories of objects from the wheels’ ray-cast.
       * @param filterGroups - Only colliders compatible with these groups will be hit by the wheels’ ray-casts.
       * @param filterPredicate - Callback to filter out which collider will be hit by the wheels’ ray-casts.
       */
      updateVehicle(dt, filterFlags, filterGroups, filterPredicate) {
        this.raw.update_vehicle(dt, this.bodies.raw, this.colliders.raw, this.queries.raw, filterFlags, filterGroups, this.colliders.castClosure(filterPredicate));
      }
      /**
       * The current forward speed of the vehicle.
       */
      currentVehicleSpeed() {
        return this.raw.current_vehicle_speed();
      }
      /**
       * The rigid-body used as the chassis.
       */
      chassis() {
        return this._chassis;
      }
      /**
       * The chassis’ local _up_ direction (`0 = x, 1 = y, 2 = z`).
       */
      get indexUpAxis() {
        return this.raw.index_up_axis();
      }
      /**
       * Sets the chassis’ local _up_ direction (`0 = x, 1 = y, 2 = z`).
       */
      set indexUpAxis(axis) {
        this.raw.set_index_up_axis(axis);
      }
      /**
       * The chassis’ local _forward_ direction (`0 = x, 1 = y, 2 = z`).
       */
      get indexForwardAxis() {
        return this.raw.index_forward_axis();
      }
      /**
       * Sets the chassis’ local _forward_ direction (`0 = x, 1 = y, 2 = z`).
       */
      set setIndexForwardAxis(axis) {
        this.raw.set_index_forward_axis(axis);
      }
      /**
       * Adds a new wheel attached to this vehicle.
       * @param chassisConnectionCs  - The position of the wheel relative to the chassis.
       * @param directionCs - The direction of the wheel’s suspension, relative to the chassis. The ray-casting will
       *                      happen following this direction to detect the ground.
       * @param axleCs - The wheel’s axle axis, relative to the chassis.
       * @param suspensionRestLength - The rest length of the wheel’s suspension spring.
       * @param radius - The wheel’s radius.
       */
      addWheel(chassisConnectionCs, directionCs, axleCs, suspensionRestLength, radius) {
        let rawChassisConnectionCs = VectorOps.intoRaw(chassisConnectionCs);
        let rawDirectionCs = VectorOps.intoRaw(directionCs);
        let rawAxleCs = VectorOps.intoRaw(axleCs);
        this.raw.add_wheel(rawChassisConnectionCs, rawDirectionCs, rawAxleCs, suspensionRestLength, radius);
        rawChassisConnectionCs.free();
        rawDirectionCs.free();
        rawAxleCs.free();
      }
      /**
       * The number of wheels attached to this vehicle.
       */
      numWheels() {
        return this.raw.num_wheels();
      }
      /*
       *
       * Access to wheel properties.
       *
       */
      /*
       * Getters + setters
       */
      /**
       * The position of the i-th wheel, relative to the chassis.
       */
      wheelChassisConnectionPointCs(i) {
        return VectorOps.fromRaw(this.raw.wheel_chassis_connection_point_cs(i));
      }
      /**
       * Sets the position of the i-th wheel, relative to the chassis.
       */
      setWheelChassisConnectionPointCs(i, value) {
        let rawValue = VectorOps.intoRaw(value);
        this.raw.set_wheel_chassis_connection_point_cs(i, rawValue);
        rawValue.free();
      }
      /**
       * The rest length of the i-th wheel’s suspension spring.
       */
      wheelSuspensionRestLength(i) {
        return this.raw.wheel_suspension_rest_length(i);
      }
      /**
       * Sets the rest length of the i-th wheel’s suspension spring.
       */
      setWheelSuspensionRestLength(i, value) {
        this.raw.set_wheel_suspension_rest_length(i, value);
      }
      /**
       * The maximum distance the i-th wheel suspension can travel before and after its resting length.
       */
      wheelMaxSuspensionTravel(i) {
        return this.raw.wheel_max_suspension_travel(i);
      }
      /**
       * Sets the maximum distance the i-th wheel suspension can travel before and after its resting length.
       */
      setWheelMaxSuspensionTravel(i, value) {
        this.raw.set_wheel_max_suspension_travel(i, value);
      }
      /**
       * The i-th wheel’s radius.
       */
      wheelRadius(i) {
        return this.raw.wheel_radius(i);
      }
      /**
       * Sets the i-th wheel’s radius.
       */
      setWheelRadius(i, value) {
        this.raw.set_wheel_radius(i, value);
      }
      /**
       * The i-th wheel’s suspension stiffness.
       *
       * Increase this value if the suspension appears to not push the vehicle strong enough.
       */
      wheelSuspensionStiffness(i) {
        return this.raw.wheel_suspension_stiffness(i);
      }
      /**
       * Sets the i-th wheel’s suspension stiffness.
       *
       * Increase this value if the suspension appears to not push the vehicle strong enough.
       */
      setWheelSuspensionStiffness(i, value) {
        this.raw.set_wheel_suspension_stiffness(i, value);
      }
      /**
       * The i-th wheel’s suspension’s damping when it is being compressed.
       */
      wheelSuspensionCompression(i) {
        return this.raw.wheel_suspension_compression(i);
      }
      /**
       * The i-th wheel’s suspension’s damping when it is being compressed.
       */
      setWheelSuspensionCompression(i, value) {
        this.raw.set_wheel_suspension_compression(i, value);
      }
      /**
       * The i-th wheel’s suspension’s damping when it is being released.
       *
       * Increase this value if the suspension appears to overshoot.
       */
      wheelSuspensionRelaxation(i) {
        return this.raw.wheel_suspension_relaxation(i);
      }
      /**
       * Sets the i-th wheel’s suspension’s damping when it is being released.
       *
       * Increase this value if the suspension appears to overshoot.
       */
      setWheelSuspensionRelaxation(i, value) {
        this.raw.set_wheel_suspension_relaxation(i, value);
      }
      /**
       * The maximum force applied by the i-th wheel’s suspension.
       */
      wheelMaxSuspensionForce(i) {
        return this.raw.wheel_max_suspension_force(i);
      }
      /**
       * Sets the maximum force applied by the i-th wheel’s suspension.
       */
      setWheelMaxSuspensionForce(i, value) {
        this.raw.set_wheel_max_suspension_force(i, value);
      }
      /**
       * The maximum amount of braking impulse applied on the i-th wheel to slow down the vehicle.
       */
      wheelBrake(i) {
        return this.raw.wheel_brake(i);
      }
      /**
       * Set the maximum amount of braking impulse applied on the i-th wheel to slow down the vehicle.
       */
      setWheelBrake(i, value) {
        this.raw.set_wheel_brake(i, value);
      }
      /**
       * The steering angle (radians) for the i-th wheel.
       */
      wheelSteering(i) {
        return this.raw.wheel_steering(i);
      }
      /**
       * Sets the steering angle (radians) for the i-th wheel.
       */
      setWheelSteering(i, value) {
        this.raw.set_wheel_steering(i, value);
      }
      /**
       * The forward force applied by the i-th wheel on the chassis.
       */
      wheelEngineForce(i) {
        return this.raw.wheel_engine_force(i);
      }
      /**
       * Sets the forward force applied by the i-th wheel on the chassis.
       */
      setWheelEngineForce(i, value) {
        this.raw.set_wheel_engine_force(i, value);
      }
      /**
       * The direction of the i-th wheel’s suspension, relative to the chassis.
       *
       * The ray-casting will happen following this direction to detect the ground.
       */
      wheelDirectionCs(i) {
        return VectorOps.fromRaw(this.raw.wheel_direction_cs(i));
      }
      /**
       * Sets the direction of the i-th wheel’s suspension, relative to the chassis.
       *
       * The ray-casting will happen following this direction to detect the ground.
       */
      setWheelDirectionCs(i, value) {
        let rawValue = VectorOps.intoRaw(value);
        this.raw.set_wheel_direction_cs(i, rawValue);
        rawValue.free();
      }
      /**
       * The i-th wheel’s axle axis, relative to the chassis.
       *
       * The axis index defined as 0 = X, 1 = Y, 2 = Z.
       */
      wheelAxleCs(i) {
        return VectorOps.fromRaw(this.raw.wheel_axle_cs(i));
      }
      /**
       * Sets the i-th wheel’s axle axis, relative to the chassis.
       *
       * The axis index defined as 0 = X, 1 = Y, 2 = Z.
       */
      setWheelAxleCs(i, value) {
        let rawValue = VectorOps.intoRaw(value);
        this.raw.set_wheel_axle_cs(i, rawValue);
        rawValue.free();
      }
      /**
       * Parameter controlling how much traction the tire has.
       *
       * The larger the value, the more instantaneous braking will happen (with the risk of
       * causing the vehicle to flip if it’s too strong).
       */
      wheelFrictionSlip(i) {
        return this.raw.wheel_friction_slip(i);
      }
      /**
       * Sets the parameter controlling how much traction the tire has.
       *
       * The larger the value, the more instantaneous braking will happen (with the risk of
       * causing the vehicle to flip if it’s too strong).
       */
      setWheelFrictionSlip(i, value) {
        this.raw.set_wheel_friction_slip(i, value);
      }
      /**
       * The multiplier of friction between a tire and the collider it’s on top of.
       *
       * The larger the value, the stronger side friction will be.
       */
      wheelSideFrictionStiffness(i) {
        return this.raw.wheel_side_friction_stiffness(i);
      }
      /**
       * The multiplier of friction between a tire and the collider it’s on top of.
       *
       * The larger the value, the stronger side friction will be.
       */
      setWheelSideFrictionStiffness(i, value) {
        this.raw.set_wheel_side_friction_stiffness(i, value);
      }
      /*
       * Getters only.
       */
      /**
       *  The i-th wheel’s current rotation angle (radians) on its axle.
       */
      wheelRotation(i) {
        return this.raw.wheel_rotation(i);
      }
      /**
       *  The forward impulses applied by the i-th wheel on the chassis.
       */
      wheelForwardImpulse(i) {
        return this.raw.wheel_forward_impulse(i);
      }
      /**
       *  The side impulses applied by the i-th wheel on the chassis.
       */
      wheelSideImpulse(i) {
        return this.raw.wheel_side_impulse(i);
      }
      /**
       *  The force applied by the i-th wheel suspension.
       */
      wheelSuspensionForce(i) {
        return this.raw.wheel_suspension_force(i);
      }
      /**
       *  The (world-space) contact normal between the i-th wheel and the floor.
       */
      wheelContactNormal(i) {
        return VectorOps.fromRaw(this.raw.wheel_contact_normal_ws(i));
      }
      /**
       *  The (world-space) point hit by the wheel’s ray-cast for the i-th wheel.
       */
      wheelContactPoint(i) {
        return VectorOps.fromRaw(this.raw.wheel_contact_point_ws(i));
      }
      /**
       *  The suspension length for the i-th wheel.
       */
      wheelSuspensionLength(i) {
        return this.raw.wheel_suspension_length(i);
      }
      /**
       *  The (world-space) starting point of the ray-cast for the i-th wheel.
       */
      wheelHardPoint(i) {
        return VectorOps.fromRaw(this.raw.wheel_hard_point_ws(i));
      }
      /**
       *  Is the i-th wheel in contact with the ground?
       */
      wheelIsInContact(i) {
        return this.raw.wheel_is_in_contact(i);
      }
      /**
       *  The collider hit by the ray-cast for the i-th wheel.
       */
      wheelGroundObject(i) {
        return this.colliders.get(this.raw.wheel_ground_object(i));
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/control/index.js
var init_control = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/control/index.js"() {
    init_character_controller();
    init_ray_cast_vehicle_controller();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/world.js
var World;
var init_world = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/world.js"() {
    init_geometry();
    init_dynamics();
    init_math();
    init_physics_pipeline();
    init_query_pipeline();
    init_serialization_pipeline();
    init_debug_render_pipeline();
    init_control();
    init_control();
    World = class _World {
      constructor(gravity, rawIntegrationParameters, rawIslands, rawBroadPhase, rawNarrowPhase, rawBodies, rawColliders, rawImpulseJoints, rawMultibodyJoints, rawCCDSolver, rawQueryPipeline, rawPhysicsPipeline, rawSerializationPipeline, rawDebugRenderPipeline) {
        this.gravity = gravity;
        this.integrationParameters = new IntegrationParameters(rawIntegrationParameters);
        this.islands = new IslandManager(rawIslands);
        this.broadPhase = new BroadPhase(rawBroadPhase);
        this.narrowPhase = new NarrowPhase(rawNarrowPhase);
        this.bodies = new RigidBodySet(rawBodies);
        this.colliders = new ColliderSet(rawColliders);
        this.impulseJoints = new ImpulseJointSet(rawImpulseJoints);
        this.multibodyJoints = new MultibodyJointSet(rawMultibodyJoints);
        this.ccdSolver = new CCDSolver(rawCCDSolver);
        this.queryPipeline = new QueryPipeline(rawQueryPipeline);
        this.physicsPipeline = new PhysicsPipeline(rawPhysicsPipeline);
        this.serializationPipeline = new SerializationPipeline(rawSerializationPipeline);
        this.debugRenderPipeline = new DebugRenderPipeline(rawDebugRenderPipeline);
        this.characterControllers = /* @__PURE__ */ new Set();
        this.vehicleControllers = /* @__PURE__ */ new Set();
        this.impulseJoints.finalizeDeserialization(this.bodies);
        this.bodies.finalizeDeserialization(this.colliders);
        this.colliders.finalizeDeserialization(this.bodies);
      }
      // #endif
      /**
       * Release the WASM memory occupied by this physics world.
       *
       * All the fields of this physics world will be freed as well,
       * so there is no need to call their `.free()` methods individually.
       */
      free() {
        this.integrationParameters.free();
        this.islands.free();
        this.broadPhase.free();
        this.narrowPhase.free();
        this.bodies.free();
        this.colliders.free();
        this.impulseJoints.free();
        this.multibodyJoints.free();
        this.ccdSolver.free();
        this.queryPipeline.free();
        this.physicsPipeline.free();
        this.serializationPipeline.free();
        this.debugRenderPipeline.free();
        this.characterControllers.forEach((controller) => controller.free());
        this.vehicleControllers.forEach((controller) => controller.free());
        this.integrationParameters = void 0;
        this.islands = void 0;
        this.broadPhase = void 0;
        this.narrowPhase = void 0;
        this.bodies = void 0;
        this.colliders = void 0;
        this.ccdSolver = void 0;
        this.impulseJoints = void 0;
        this.multibodyJoints = void 0;
        this.queryPipeline = void 0;
        this.physicsPipeline = void 0;
        this.serializationPipeline = void 0;
        this.debugRenderPipeline = void 0;
        this.characterControllers = void 0;
        this.vehicleControllers = void 0;
      }
      static fromRaw(raw) {
        if (!raw)
          return null;
        return new _World(VectorOps.fromRaw(raw.takeGravity()), raw.takeIntegrationParameters(), raw.takeIslandManager(), raw.takeBroadPhase(), raw.takeNarrowPhase(), raw.takeBodies(), raw.takeColliders(), raw.takeImpulseJoints(), raw.takeMultibodyJoints());
      }
      /**
       * Takes a snapshot of this world.
       *
       * Use `World.restoreSnapshot` to create a new physics world with a state identical to
       * the state when `.takeSnapshot()` is called.
       */
      takeSnapshot() {
        return this.serializationPipeline.serializeAll(this.gravity, this.integrationParameters, this.islands, this.broadPhase, this.narrowPhase, this.bodies, this.colliders, this.impulseJoints, this.multibodyJoints);
      }
      /**
       * Creates a new physics world from a snapshot.
       *
       * This new physics world will be an identical copy of the snapshoted physics world.
       */
      static restoreSnapshot(data) {
        let deser = new SerializationPipeline();
        return deser.deserializeAll(data);
      }
      /**
       * Computes all the lines (and their colors) needed to render the scene.
       */
      debugRender() {
        this.debugRenderPipeline.render(this.bodies, this.colliders, this.impulseJoints, this.multibodyJoints, this.narrowPhase);
        return new DebugRenderBuffers(this.debugRenderPipeline.vertices, this.debugRenderPipeline.colors);
      }
      /**
       * Advance the simulation by one time step.
       *
       * All events generated by the physics engine are ignored.
       *
       * @param EventQueue - (optional) structure responsible for collecting
       *   events generated by the physics engine.
       */
      step(eventQueue, hooks) {
        this.physicsPipeline.step(this.gravity, this.integrationParameters, this.islands, this.broadPhase, this.narrowPhase, this.bodies, this.colliders, this.impulseJoints, this.multibodyJoints, this.ccdSolver, eventQueue, hooks);
        this.queryPipeline.update(this.colliders);
      }
      /**
       * Update colliders positions after rigid-bodies moved.
       *
       * When a rigid-body moves, the positions of the colliders attached to it need to be updated. This update is
       * generally automatically done at the beginning and the end of each simulation step with World.step.
       * If the positions need to be updated without running a simulation step this method can be called manually.
       */
      propagateModifiedBodyPositionsToColliders() {
        this.bodies.raw.propagateModifiedBodyPositionsToColliders(this.colliders.raw);
      }
      /**
       * Ensure subsequent scene queries take into account the collider positions set before this method is called.
       *
       * This does not step the physics simulation forward.
       */
      updateSceneQueries() {
        this.propagateModifiedBodyPositionsToColliders();
        this.queryPipeline.update(this.colliders);
      }
      /**
       * The current simulation timestep.
       */
      get timestep() {
        return this.integrationParameters.dt;
      }
      /**
       * Sets the new simulation timestep.
       *
       * The simulation timestep governs by how much the physics state of the world will
       * be integrated. A simulation timestep should:
       * - be as small as possible. Typical values evolve around 0.016 (assuming the chosen unit is milliseconds,
       * corresponds to the time between two frames of a game running at 60FPS).
       * - not vary too much during the course of the simulation. A timestep with large variations may
       * cause instabilities in the simulation.
       *
       * @param dt - The timestep length, in seconds.
       */
      set timestep(dt) {
        this.integrationParameters.dt = dt;
      }
      /**
       * The approximate size of most dynamic objects in the scene.
       *
       * See the documentation of the `World.lengthUnit` setter for further details.
       */
      get lengthUnit() {
        return this.integrationParameters.lengthUnit;
      }
      /**
       * The approximate size of most dynamic objects in the scene.
       *
       * This value is used internally to estimate some length-based tolerance. In particular, the
       * values `IntegrationParameters.allowedLinearError`,
       * `IntegrationParameters.maxPenetrationCorrection`,
       * `IntegrationParameters.predictionDistance`, `RigidBodyActivation.linearThreshold`
       * are scaled by this value implicitly.
       *
       * This value can be understood as the number of units-per-meter in your physical world compared
       * to a human-sized world in meter. For example, in a 2d game, if your typical object size is 100
       * pixels, set the `[`Self::length_unit`]` parameter to 100.0. The physics engine will interpret
       * it as if 100 pixels is equivalent to 1 meter in its various internal threshold.
       * (default `1.0`).
       */
      set lengthUnit(unitsPerMeter) {
        this.integrationParameters.lengthUnit = unitsPerMeter;
      }
      /**
       * The number of solver iterations run by the constraints solver for calculating forces (default: `4`).
       */
      get numSolverIterations() {
        return this.integrationParameters.numSolverIterations;
      }
      /**
       * Sets the number of solver iterations run by the constraints solver for calculating forces (default: `4`).
       *
       * The greater this value is, the most rigid and realistic the physics simulation will be.
       * However a greater number of iterations is more computationally intensive.
       *
       * @param niter - The new number of solver iterations.
       */
      set numSolverIterations(niter) {
        this.integrationParameters.numSolverIterations = niter;
      }
      /**
       * Number of addition friction resolution iteration run during the last solver sub-step (default: `4`).
       */
      get numAdditionalFrictionIterations() {
        return this.integrationParameters.numAdditionalFrictionIterations;
      }
      /**
       * Sets the number of addition friction resolution iteration run during the last solver sub-step (default: `4`).
       *
       * The greater this value is, the most realistic friction will be.
       * However a greater number of iterations is more computationally intensive.
       *
       * @param niter - The new number of additional friction iterations.
       */
      set numAdditionalFrictionIterations(niter) {
        this.integrationParameters.numAdditionalFrictionIterations = niter;
      }
      /**
       * Number of internal Project Gauss Seidel (PGS) iterations run at each solver iteration (default: `1`).
       */
      get numInternalPgsIterations() {
        return this.integrationParameters.numInternalPgsIterations;
      }
      /**
       * Sets the Number of internal Project Gauss Seidel (PGS) iterations run at each solver iteration (default: `1`).
       *
       * Increasing this parameter will improve stability of the simulation. It will have a lesser effect than
       * increasing `numSolverIterations` but is also less computationally expensive.
       *
       * @param niter - The new number of internal PGS iterations.
       */
      set numInternalPgsIterations(niter) {
        this.integrationParameters.numInternalPgsIterations = niter;
      }
      /// Configures the integration parameters to match the old PGS solver
      /// from Rapier JS version <= 0.11.
      ///
      /// This solver was slightly faster than the new one but resulted
      /// in less stable joints and worse convergence rates.
      ///
      /// This should only be used for comparison purpose or if you are
      /// experiencing problems with the new solver.
      ///
      /// NOTE: this does not affect any `RigidBody.additional_solver_iterations` that will
      ///       still create solver iterations based on the new "small-steps" PGS solver.
      switchToStandardPgsSolver() {
        this.integrationParameters.switchToStandardPgsSolver();
      }
      /// Configures the integration parameters to match the new "small-steps" PGS solver
      /// from Rapier version >= 0.12.
      ///
      /// The "small-steps" PGS solver is the default one when creating the physics world. So
      /// calling this function is generally not needed unless `World.switch_to_standard_pgs_solver`
      /// was called.
      ///
      /// This solver results in more stable joints and significantly better convergence
      /// rates but is slightly slower in its default settings.
      switchToSmallStepsPgsSolver() {
        this.integrationParameters.switchToSmallStepsPgsSolver();
      }
      /// Configures the integration parameters to match the new "small-steps" PGS solver
      /// from Rapier version >= 0.12. Warmstarting is disabled.
      ///
      /// The "small-steps" PGS solver is the default one when creating the physics world. So
      /// calling this function is generally not needed unless `World.switch_to_standard_pgs_solver`
      /// was called.
      ///
      /// This solver results in more stable joints and significantly better convergence
      /// rates but is slightly slower in its default settings.
      switchToSmallStepsPgsSolverWithoutWarmstart() {
        this.integrationParameters.switchToSmallStepsPgsSolverWithoutWarmstart();
      }
      /**
       * Creates a new rigid-body from the given rigid-body descriptor.
       *
       * @param body - The description of the rigid-body to create.
       */
      createRigidBody(body) {
        return this.bodies.createRigidBody(this.colliders, body);
      }
      /**
       * Creates a new character controller.
       *
       * @param offset - The artificial gap added between the character’s chape and its environment.
       */
      createCharacterController(offset) {
        let controller = new KinematicCharacterController(offset, this.integrationParameters, this.bodies, this.colliders, this.queryPipeline);
        this.characterControllers.add(controller);
        return controller;
      }
      /**
       * Removes a character controller from this world.
       *
       * @param controller - The character controller to remove.
       */
      removeCharacterController(controller) {
        this.characterControllers.delete(controller);
        controller.free();
      }
      // #if DIM3
      /**
       * Creates a new vehicle controller.
       *
       * @param chassis - The rigid-body used as the chassis of the vehicle controller. When the vehicle
       *                  controller is updated, it will change directly the rigid-body’s velocity. This
       *                  rigid-body must be a dynamic or kinematic-velocity-based rigid-body.
       */
      createVehicleController(chassis) {
        let controller = new DynamicRayCastVehicleController(chassis, this.bodies, this.colliders, this.queryPipeline);
        this.vehicleControllers.add(controller);
        return controller;
      }
      /**
       * Removes a vehicle controller from this world.
       *
       * @param controller - The vehicle controller to remove.
       */
      removeVehicleController(controller) {
        this.vehicleControllers.delete(controller);
        controller.free();
      }
      // #endif
      /**
       * Creates a new collider.
       *
       * @param desc - The description of the collider.
       * @param parent - The rigid-body this collider is attached to.
       */
      createCollider(desc, parent) {
        let parentHandle = parent ? parent.handle : void 0;
        return this.colliders.createCollider(this.bodies, desc, parentHandle);
      }
      /**
       * Creates a new impulse joint from the given joint descriptor.
       *
       * @param params - The description of the joint to create.
       * @param parent1 - The first rigid-body attached to this joint.
       * @param parent2 - The second rigid-body attached to this joint.
       * @param wakeUp - Should the attached rigid-bodies be awakened?
       */
      createImpulseJoint(params, parent1, parent2, wakeUp) {
        return this.impulseJoints.createJoint(this.bodies, params, parent1.handle, parent2.handle, wakeUp);
      }
      /**
       * Creates a new multibody joint from the given joint descriptor.
       *
       * @param params - The description of the joint to create.
       * @param parent1 - The first rigid-body attached to this joint.
       * @param parent2 - The second rigid-body attached to this joint.
       * @param wakeUp - Should the attached rigid-bodies be awakened?
       */
      createMultibodyJoint(params, parent1, parent2, wakeUp) {
        return this.multibodyJoints.createJoint(params, parent1.handle, parent2.handle, wakeUp);
      }
      /**
       * Retrieves a rigid-body from its handle.
       *
       * @param handle - The integer handle of the rigid-body to retrieve.
       */
      getRigidBody(handle) {
        return this.bodies.get(handle);
      }
      /**
       * Retrieves a collider from its handle.
       *
       * @param handle - The integer handle of the collider to retrieve.
       */
      getCollider(handle) {
        return this.colliders.get(handle);
      }
      /**
       * Retrieves an impulse joint from its handle.
       *
       * @param handle - The integer handle of the impulse joint to retrieve.
       */
      getImpulseJoint(handle) {
        return this.impulseJoints.get(handle);
      }
      /**
       * Retrieves an multibody joint from its handle.
       *
       * @param handle - The integer handle of the multibody joint to retrieve.
       */
      getMultibodyJoint(handle) {
        return this.multibodyJoints.get(handle);
      }
      /**
       * Removes the given rigid-body from this physics world.
       *
       * This will remove this rigid-body as well as all its attached colliders and joints.
       * Every other bodies touching or attached by joints to this rigid-body will be woken-up.
       *
       * @param body - The rigid-body to remove.
       */
      removeRigidBody(body) {
        if (this.bodies) {
          this.bodies.remove(body.handle, this.islands, this.colliders, this.impulseJoints, this.multibodyJoints);
        }
      }
      /**
       * Removes the given collider from this physics world.
       *
       * @param collider - The collider to remove.
       * @param wakeUp - If set to `true`, the rigid-body this collider is attached to will be awaken.
       */
      removeCollider(collider, wakeUp) {
        if (this.colliders) {
          this.colliders.remove(collider.handle, this.islands, this.bodies, wakeUp);
        }
      }
      /**
       * Removes the given impulse joint from this physics world.
       *
       * @param joint - The impulse joint to remove.
       * @param wakeUp - If set to `true`, the rigid-bodies attached by this joint will be awaken.
       */
      removeImpulseJoint(joint, wakeUp) {
        if (this.impulseJoints) {
          this.impulseJoints.remove(joint.handle, wakeUp);
        }
      }
      /**
       * Removes the given multibody joint from this physics world.
       *
       * @param joint - The multibody joint to remove.
       * @param wakeUp - If set to `true`, the rigid-bodies attached by this joint will be awaken.
       */
      removeMultibodyJoint(joint, wakeUp) {
        if (this.impulseJoints) {
          this.multibodyJoints.remove(joint.handle, wakeUp);
        }
      }
      /**
       * Applies the given closure to each collider managed by this physics world.
       *
       * @param f(collider) - The function to apply to each collider managed by this physics world. Called as `f(collider)`.
       */
      forEachCollider(f) {
        this.colliders.forEach(f);
      }
      /**
       * Applies the given closure to each rigid-body managed by this physics world.
       *
       * @param f(body) - The function to apply to each rigid-body managed by this physics world. Called as `f(collider)`.
       */
      forEachRigidBody(f) {
        this.bodies.forEach(f);
      }
      /**
       * Applies the given closure to each active rigid-body managed by this physics world.
       *
       * After a short time of inactivity, a rigid-body is automatically deactivated ("asleep") by
       * the physics engine in order to save computational power. A sleeping rigid-body never moves
       * unless it is moved manually by the user.
       *
       * @param f - The function to apply to each active rigid-body managed by this physics world. Called as `f(collider)`.
       */
      forEachActiveRigidBody(f) {
        this.bodies.forEachActiveRigidBody(this.islands, f);
      }
      /**
       * Find the closest intersection between a ray and the physics world.
       *
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       * @param filter - The callback to filter out which collider will be hit.
       */
      castRay(ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        return this.queryPipeline.castRay(this.bodies, this.colliders, ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Find the closest intersection between a ray and the physics world.
       *
       * This also computes the normal at the hit point.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       */
      castRayAndGetNormal(ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        return this.queryPipeline.castRayAndGetNormal(this.bodies, this.colliders, ray, maxToi, solid, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Cast a ray and collects all the intersections between a ray and the scene.
       *
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @param groups - Used to filter the colliders that can or cannot be hit by the ray.
       * @param callback - The callback called once per hit (in no particular order) between a ray and a collider.
       *   If this callback returns `false`, then the cast will stop and no further hits will be detected/reported.
       */
      intersectionsWithRay(ray, maxToi, solid, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        this.queryPipeline.intersectionsWithRay(this.bodies, this.colliders, ray, maxToi, solid, callback, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Gets the handle of up to one collider intersecting the given shape.
       *
       * @param shapePos - The position of the shape used for the intersection test.
       * @param shapeRot - The orientation of the shape used for the intersection test.
       * @param shape - The shape used for the intersection test.
       * @param groups - The bit groups and filter associated to the ray, in order to only
       *   hit the colliders with collision groups compatible with the ray's group.
       */
      intersectionWithShape(shapePos, shapeRot, shape, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        let handle = this.queryPipeline.intersectionWithShape(this.bodies, this.colliders, shapePos, shapeRot, shape, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
        return handle != null ? this.colliders.get(handle) : null;
      }
      /**
       * Find the projection of a point on the closest collider.
       *
       * @param point - The point to project.
       * @param solid - If this is set to `true` then the collider shapes are considered to
       *   be plain (if the point is located inside of a plain shape, its projection is the point
       *   itself). If it is set to `false` the collider shapes are considered to be hollow
       *   (if the point is located inside of an hollow shape, it is projected on the shape's
       *   boundary).
       * @param groups - The bit groups and filter associated to the point to project, in order to only
       *   project on colliders with collision groups compatible with the ray's group.
       */
      projectPoint(point, solid, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        return this.queryPipeline.projectPoint(this.bodies, this.colliders, point, solid, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Find the projection of a point on the closest collider.
       *
       * @param point - The point to project.
       * @param groups - The bit groups and filter associated to the point to project, in order to only
       *   project on colliders with collision groups compatible with the ray's group.
       */
      projectPointAndGetFeature(point, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        return this.queryPipeline.projectPointAndGetFeature(this.bodies, this.colliders, point, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Find all the colliders containing the given point.
       *
       * @param point - The point used for the containment test.
       * @param groups - The bit groups and filter associated to the point to test, in order to only
       *   test on colliders with collision groups compatible with the ray's group.
       * @param callback - A function called with the handles of each collider with a shape
       *   containing the `point`.
       */
      intersectionsWithPoint(point, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        this.queryPipeline.intersectionsWithPoint(this.bodies, this.colliders, point, this.colliders.castClosure(callback), filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Casts a shape at a constant linear velocity and retrieve the first collider it hits.
       * This is similar to ray-casting except that we are casting a whole shape instead of
       * just a point (the ray origin).
       *
       * @param shapePos - The initial position of the shape to cast.
       * @param shapeRot - The initial rotation of the shape to cast.
       * @param shapeVel - The constant velocity of the shape to cast (i.e. the cast direction).
       * @param shape - The shape to cast.
       * @param targetDistance − If the shape moves closer to this distance from a collider, a hit
       *                         will be returned.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the distance traveled by the shape to `shapeVel.norm() * maxToi`.
       * @param stopAtPenetration - If set to `false`, the linear shape-cast won’t immediately stop if
       *   the shape is penetrating another shape at its starting point **and** its trajectory is such
       *   that it’s on a path to exit that penetration state.
       * @param groups - The bit groups and filter associated to the shape to cast, in order to only
       *   test on colliders with collision groups compatible with this group.
       */
      castShape(shapePos, shapeRot, shapeVel, shape, targetDistance, maxToi, stopAtPenetration, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        return this.queryPipeline.castShape(this.bodies, this.colliders, shapePos, shapeRot, shapeVel, shape, targetDistance, maxToi, stopAtPenetration, filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Retrieve all the colliders intersecting the given shape.
       *
       * @param shapePos - The position of the shape to test.
       * @param shapeRot - The orientation of the shape to test.
       * @param shape - The shape to test.
       * @param groups - The bit groups and filter associated to the shape to test, in order to only
       *   test on colliders with collision groups compatible with this group.
       * @param callback - A function called with the handles of each collider intersecting the `shape`.
       */
      intersectionsWithShape(shapePos, shapeRot, shape, callback, filterFlags, filterGroups, filterExcludeCollider, filterExcludeRigidBody, filterPredicate) {
        this.queryPipeline.intersectionsWithShape(this.bodies, this.colliders, shapePos, shapeRot, shape, this.colliders.castClosure(callback), filterFlags, filterGroups, filterExcludeCollider ? filterExcludeCollider.handle : null, filterExcludeRigidBody ? filterExcludeRigidBody.handle : null, this.colliders.castClosure(filterPredicate));
      }
      /**
       * Finds the handles of all the colliders with an AABB intersecting the given AABB.
       *
       * @param aabbCenter - The center of the AABB to test.
       * @param aabbHalfExtents - The half-extents of the AABB to test.
       * @param callback - The callback that will be called with the handles of all the colliders
       *                   currently intersecting the given AABB.
       */
      collidersWithAabbIntersectingAabb(aabbCenter, aabbHalfExtents, callback) {
        this.queryPipeline.collidersWithAabbIntersectingAabb(aabbCenter, aabbHalfExtents, this.colliders.castClosure(callback));
      }
      /**
       * Enumerates all the colliders potentially in contact with the given collider.
       *
       * @param collider1 - The second collider involved in the contact.
       * @param f - Closure that will be called on each collider that is in contact with `collider1`.
       */
      contactPairsWith(collider1, f) {
        this.narrowPhase.contactPairsWith(collider1.handle, this.colliders.castClosure(f));
      }
      /**
       * Enumerates all the colliders intersecting the given colliders, assuming one of them
       * is a sensor.
       */
      intersectionPairsWith(collider1, f) {
        this.narrowPhase.intersectionPairsWith(collider1.handle, this.colliders.castClosure(f));
      }
      /**
       * Iterates through all the contact manifolds between the given pair of colliders.
       *
       * @param collider1 - The first collider involved in the contact.
       * @param collider2 - The second collider involved in the contact.
       * @param f - Closure that will be called on each contact manifold between the two colliders. If the second argument
       *            passed to this closure is `true`, then the contact manifold data is flipped, i.e., methods like `localNormal1`
       *            actually apply to the `collider2` and fields like `localNormal2` apply to the `collider1`.
       */
      contactPair(collider1, collider2, f) {
        this.narrowPhase.contactPair(collider1.handle, collider2.handle, f);
      }
      /**
       * Returns `true` if `collider1` and `collider2` intersect and at least one of them is a sensor.
       * @param collider1 − The first collider involved in the intersection.
       * @param collider2 − The second collider involved in the intersection.
       */
      intersectionPair(collider1, collider2) {
        return this.narrowPhase.intersectionPair(collider1.handle, collider2.handle);
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/event_queue.js
var ActiveEvents, TempContactForceEvent, EventQueue;
var init_event_queue = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/event_queue.js"() {
    init_raw();
    init_math();
    (function(ActiveEvents2) {
      ActiveEvents2[ActiveEvents2["NONE"] = 0] = "NONE";
      ActiveEvents2[ActiveEvents2["COLLISION_EVENTS"] = 1] = "COLLISION_EVENTS";
      ActiveEvents2[ActiveEvents2["CONTACT_FORCE_EVENTS"] = 2] = "CONTACT_FORCE_EVENTS";
    })(ActiveEvents || (ActiveEvents = {}));
    TempContactForceEvent = class {
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * The first collider involved in the contact.
       */
      collider1() {
        return this.raw.collider1();
      }
      /**
       * The second collider involved in the contact.
       */
      collider2() {
        return this.raw.collider2();
      }
      /**
       * The sum of all the forces between the two colliders.
       */
      totalForce() {
        return VectorOps.fromRaw(this.raw.total_force());
      }
      /**
       * The sum of the magnitudes of each force between the two colliders.
       *
       * Note that this is **not** the same as the magnitude of `self.total_force`.
       * Here we are summing the magnitude of all the forces, instead of taking
       * the magnitude of their sum.
       */
      totalForceMagnitude() {
        return this.raw.total_force_magnitude();
      }
      /**
       * The world-space (unit) direction of the force with strongest magnitude.
       */
      maxForceDirection() {
        return VectorOps.fromRaw(this.raw.max_force_direction());
      }
      /**
       * The magnitude of the largest force at a contact point of this contact pair.
       */
      maxForceMagnitude() {
        return this.raw.max_force_magnitude();
      }
    };
    EventQueue = class {
      /**
       * Creates a new event collector.
       *
       * @param autoDrain -setting this to `true` is strongly recommended. If true, the collector will
       * be automatically drained before each `world.step(collector)`. If false, the collector will
       * keep all events in memory unless it is manually drained/cleared; this may lead to unbounded use of
       * RAM if no drain is performed.
       */
      constructor(autoDrain, raw) {
        this.raw = raw || new RawEventQueue(autoDrain);
      }
      /**
       * Release the WASM memory occupied by this event-queue.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
      }
      /**
       * Applies the given javascript closure on each collision event of this collector, then clear
       * the internal collision event buffer.
       *
       * @param f - JavaScript closure applied to each collision event. The
       * closure must take three arguments: two integers representing the handles of the colliders
       * involved in the collision, and a boolean indicating if the collision started (true) or stopped
       * (false).
       */
      drainCollisionEvents(f) {
        this.raw.drainCollisionEvents(f);
      }
      /**
       * Applies the given javascript closure on each contact force event of this collector, then clear
       * the internal collision event buffer.
       *
       * @param f - JavaScript closure applied to each collision event. The
       *            closure must take one `TempContactForceEvent` argument.
       */
      drainContactForceEvents(f) {
        let event = new TempContactForceEvent();
        this.raw.drainContactForceEvents((raw) => {
          event.raw = raw;
          f(event);
          event.free();
        });
      }
      /**
       * Removes all events contained by this collector
       */
      clear() {
        this.raw.clear();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/physics_hooks.js
var ActiveHooks, SolverFlags;
var init_physics_hooks = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/physics_hooks.js"() {
    (function(ActiveHooks2) {
      ActiveHooks2[ActiveHooks2["NONE"] = 0] = "NONE";
      ActiveHooks2[ActiveHooks2["FILTER_CONTACT_PAIRS"] = 1] = "FILTER_CONTACT_PAIRS";
      ActiveHooks2[ActiveHooks2["FILTER_INTERSECTION_PAIRS"] = 2] = "FILTER_INTERSECTION_PAIRS";
    })(ActiveHooks || (ActiveHooks = {}));
    (function(SolverFlags2) {
      SolverFlags2[SolverFlags2["EMPTY"] = 0] = "EMPTY";
      SolverFlags2[SolverFlags2["COMPUTE_IMPULSE"] = 1] = "COMPUTE_IMPULSE";
    })(SolverFlags || (SolverFlags = {}));
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/pipeline/index.js
var init_pipeline = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/pipeline/index.js"() {
    init_world();
    init_physics_pipeline();
    init_serialization_pipeline();
    init_event_queue();
    init_physics_hooks();
    init_debug_render_pipeline();
    init_query_pipeline();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/collider.js
var ActiveCollisionTypes, Collider, MassPropsMode, ColliderDesc;
var init_collider = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/collider.js"() {
    init_math();
    init_dynamics();
    init_pipeline();
    init_shape();
    init_ray();
    init_point();
    init_toi();
    init_contact();
    (function(ActiveCollisionTypes2) {
      ActiveCollisionTypes2[ActiveCollisionTypes2["DYNAMIC_DYNAMIC"] = 1] = "DYNAMIC_DYNAMIC";
      ActiveCollisionTypes2[ActiveCollisionTypes2["DYNAMIC_KINEMATIC"] = 12] = "DYNAMIC_KINEMATIC";
      ActiveCollisionTypes2[ActiveCollisionTypes2["DYNAMIC_FIXED"] = 2] = "DYNAMIC_FIXED";
      ActiveCollisionTypes2[ActiveCollisionTypes2["KINEMATIC_KINEMATIC"] = 52224] = "KINEMATIC_KINEMATIC";
      ActiveCollisionTypes2[ActiveCollisionTypes2["KINEMATIC_FIXED"] = 8704] = "KINEMATIC_FIXED";
      ActiveCollisionTypes2[ActiveCollisionTypes2["FIXED_FIXED"] = 32] = "FIXED_FIXED";
      ActiveCollisionTypes2[ActiveCollisionTypes2["DEFAULT"] = 15] = "DEFAULT";
      ActiveCollisionTypes2[ActiveCollisionTypes2["ALL"] = 60943] = "ALL";
    })(ActiveCollisionTypes || (ActiveCollisionTypes = {}));
    Collider = class {
      constructor(colliderSet, handle, parent, shape) {
        this.colliderSet = colliderSet;
        this.handle = handle;
        this._parent = parent;
        this._shape = shape;
      }
      /** @internal */
      finalizeDeserialization(bodies) {
        if (this.handle != null) {
          this._parent = bodies.get(this.colliderSet.raw.coParent(this.handle));
        }
      }
      ensureShapeIsCached() {
        if (!this._shape)
          this._shape = Shape.fromRaw(this.colliderSet.raw, this.handle);
      }
      /**
       * The shape of this collider.
       */
      get shape() {
        this.ensureShapeIsCached();
        return this._shape;
      }
      /**
       * Checks if this collider is still valid (i.e. that it has
       * not been deleted from the collider set yet).
       */
      isValid() {
        return this.colliderSet.raw.contains(this.handle);
      }
      /**
       * The world-space translation of this rigid-body.
       */
      translation() {
        return VectorOps.fromRaw(this.colliderSet.raw.coTranslation(this.handle));
      }
      /**
       * The world-space orientation of this rigid-body.
       */
      rotation() {
        return RotationOps.fromRaw(this.colliderSet.raw.coRotation(this.handle));
      }
      /**
       * Is this collider a sensor?
       */
      isSensor() {
        return this.colliderSet.raw.coIsSensor(this.handle);
      }
      /**
       * Sets whether or not this collider is a sensor.
       * @param isSensor - If `true`, the collider will be a sensor.
       */
      setSensor(isSensor) {
        this.colliderSet.raw.coSetSensor(this.handle, isSensor);
      }
      /**
       * Sets the new shape of the collider.
       * @param shape - The collider’s new shape.
       */
      setShape(shape) {
        let rawShape = shape.intoRaw();
        this.colliderSet.raw.coSetShape(this.handle, rawShape);
        rawShape.free();
        this._shape = shape;
      }
      /**
       * Sets whether this collider is enabled or not.
       *
       * @param enabled - Set to `false` to disable this collider (its parent rigid-body won’t be disabled automatically by this).
       */
      setEnabled(enabled) {
        this.colliderSet.raw.coSetEnabled(this.handle, enabled);
      }
      /**
       * Is this collider enabled?
       */
      isEnabled() {
        return this.colliderSet.raw.coIsEnabled(this.handle);
      }
      /**
       * Sets the restitution coefficient of the collider to be created.
       *
       * @param restitution - The restitution coefficient in `[0, 1]`. A value of 0 (the default) means no bouncing behavior
       *                   while 1 means perfect bouncing (though energy may still be lost due to numerical errors of the
       *                   constraints solver).
       */
      setRestitution(restitution) {
        this.colliderSet.raw.coSetRestitution(this.handle, restitution);
      }
      /**
       * Sets the friction coefficient of the collider to be created.
       *
       * @param friction - The friction coefficient. Must be greater or equal to 0. This is generally smaller than 1. The
       *                   higher the coefficient, the stronger friction forces will be for contacts with the collider
       *                   being built.
       */
      setFriction(friction) {
        this.colliderSet.raw.coSetFriction(this.handle, friction);
      }
      /**
       * Gets the rule used to combine the friction coefficients of two colliders
       * colliders involved in a contact.
       */
      frictionCombineRule() {
        return this.colliderSet.raw.coFrictionCombineRule(this.handle);
      }
      /**
       * Sets the rule used to combine the friction coefficients of two colliders
       * colliders involved in a contact.
       *
       * @param rule − The combine rule to apply.
       */
      setFrictionCombineRule(rule) {
        this.colliderSet.raw.coSetFrictionCombineRule(this.handle, rule);
      }
      /**
       * Gets the rule used to combine the restitution coefficients of two colliders
       * colliders involved in a contact.
       */
      restitutionCombineRule() {
        return this.colliderSet.raw.coRestitutionCombineRule(this.handle);
      }
      /**
       * Sets the rule used to combine the restitution coefficients of two colliders
       * colliders involved in a contact.
       *
       * @param rule − The combine rule to apply.
       */
      setRestitutionCombineRule(rule) {
        this.colliderSet.raw.coSetRestitutionCombineRule(this.handle, rule);
      }
      /**
       * Sets the collision groups used by this collider.
       *
       * Two colliders will interact iff. their collision groups are compatible.
       * See the documentation of `InteractionGroups` for details on teh used bit pattern.
       *
       * @param groups - The collision groups used for the collider being built.
       */
      setCollisionGroups(groups) {
        this.colliderSet.raw.coSetCollisionGroups(this.handle, groups);
      }
      /**
       * Sets the solver groups used by this collider.
       *
       * Forces between two colliders in contact will be computed iff their solver
       * groups are compatible.
       * See the documentation of `InteractionGroups` for details on the used bit pattern.
       *
       * @param groups - The solver groups used for the collider being built.
       */
      setSolverGroups(groups) {
        this.colliderSet.raw.coSetSolverGroups(this.handle, groups);
      }
      /**
       * Sets the contact skin for this collider.
       *
       * See the documentation of `ColliderDesc.setContactSkin` for additional details.
       */
      contactSkin() {
        return this.colliderSet.raw.coContactSkin(this.handle);
      }
      /**
       * Sets the contact skin for this collider.
       *
       * See the documentation of `ColliderDesc.setContactSkin` for additional details.
       *
       * @param thickness - The contact skin thickness.
       */
      setContactSkin(thickness) {
        return this.colliderSet.raw.coSetContactSkin(this.handle, thickness);
      }
      /**
       * Get the physics hooks active for this collider.
       */
      activeHooks() {
        return this.colliderSet.raw.coActiveHooks(this.handle);
      }
      /**
       * Set the physics hooks active for this collider.
       *
       * Use this to enable custom filtering rules for contact/intersecstion pairs involving this collider.
       *
       * @param activeHooks - The hooks active for contact/intersection pairs involving this collider.
       */
      setActiveHooks(activeHooks) {
        this.colliderSet.raw.coSetActiveHooks(this.handle, activeHooks);
      }
      /**
       * The events active for this collider.
       */
      activeEvents() {
        return this.colliderSet.raw.coActiveEvents(this.handle);
      }
      /**
       * Set the events active for this collider.
       *
       * Use this to enable contact and/or intersection event reporting for this collider.
       *
       * @param activeEvents - The events active for contact/intersection pairs involving this collider.
       */
      setActiveEvents(activeEvents) {
        this.colliderSet.raw.coSetActiveEvents(this.handle, activeEvents);
      }
      /**
       * Gets the collision types active for this collider.
       */
      activeCollisionTypes() {
        return this.colliderSet.raw.coActiveCollisionTypes(this.handle);
      }
      /**
       * Sets the total force magnitude beyond which a contact force event can be emitted.
       *
       * @param threshold - The new force threshold.
       */
      setContactForceEventThreshold(threshold) {
        return this.colliderSet.raw.coSetContactForceEventThreshold(this.handle, threshold);
      }
      /**
       * The total force magnitude beyond which a contact force event can be emitted.
       */
      contactForceEventThreshold() {
        return this.colliderSet.raw.coContactForceEventThreshold(this.handle);
      }
      /**
       * Set the collision types active for this collider.
       *
       * @param activeCollisionTypes - The hooks active for contact/intersection pairs involving this collider.
       */
      setActiveCollisionTypes(activeCollisionTypes) {
        this.colliderSet.raw.coSetActiveCollisionTypes(this.handle, activeCollisionTypes);
      }
      /**
       * Sets the uniform density of this collider.
       *
       * This will override any previous mass-properties set by `this.setDensity`,
       * `this.setMass`, `this.setMassProperties`, `ColliderDesc.density`,
       * `ColliderDesc.mass`, or `ColliderDesc.massProperties` for this collider.
       *
       * The mass and angular inertia of this collider will be computed automatically based on its
       * shape.
       */
      setDensity(density) {
        this.colliderSet.raw.coSetDensity(this.handle, density);
      }
      /**
       * Sets the mass of this collider.
       *
       * This will override any previous mass-properties set by `this.setDensity`,
       * `this.setMass`, `this.setMassProperties`, `ColliderDesc.density`,
       * `ColliderDesc.mass`, or `ColliderDesc.massProperties` for this collider.
       *
       * The angular inertia of this collider will be computed automatically based on its shape
       * and this mass value.
       */
      setMass(mass) {
        this.colliderSet.raw.coSetMass(this.handle, mass);
      }
      // #if DIM3
      /**
       * Sets the mass of this collider.
       *
       * This will override any previous mass-properties set by `this.setDensity`,
       * `this.setMass`, `this.setMassProperties`, `ColliderDesc.density`,
       * `ColliderDesc.mass`, or `ColliderDesc.massProperties` for this collider.
       */
      setMassProperties(mass, centerOfMass, principalAngularInertia, angularInertiaLocalFrame) {
        let rawCom = VectorOps.intoRaw(centerOfMass);
        let rawPrincipalInertia = VectorOps.intoRaw(principalAngularInertia);
        let rawInertiaFrame = RotationOps.intoRaw(angularInertiaLocalFrame);
        this.colliderSet.raw.coSetMassProperties(this.handle, mass, rawCom, rawPrincipalInertia, rawInertiaFrame);
        rawCom.free();
        rawPrincipalInertia.free();
        rawInertiaFrame.free();
      }
      // #endif
      /**
       * Sets the translation of this collider.
       *
       * @param tra - The world-space position of the collider.
       */
      setTranslation(tra) {
        this.colliderSet.raw.coSetTranslation(this.handle, tra.x, tra.y, tra.z);
      }
      /**
       * Sets the translation of this collider relative to its parent rigid-body.
       *
       * Does nothing if this collider isn't attached to a rigid-body.
       *
       * @param tra - The new translation of the collider relative to its parent.
       */
      setTranslationWrtParent(tra) {
        this.colliderSet.raw.coSetTranslationWrtParent(this.handle, tra.x, tra.y, tra.z);
      }
      // #if DIM3
      /**
       * Sets the rotation quaternion of this collider.
       *
       * This does nothing if a zero quaternion is provided.
       *
       * @param rotation - The rotation to set.
       */
      setRotation(rot) {
        this.colliderSet.raw.coSetRotation(this.handle, rot.x, rot.y, rot.z, rot.w);
      }
      /**
       * Sets the rotation quaternion of this collider relative to its parent rigid-body.
       *
       * This does nothing if a zero quaternion is provided or if this collider isn't
       * attached to a rigid-body.
       *
       * @param rotation - The rotation to set.
       */
      setRotationWrtParent(rot) {
        this.colliderSet.raw.coSetRotationWrtParent(this.handle, rot.x, rot.y, rot.z, rot.w);
      }
      // #endif
      /**
       * The type of the shape of this collider.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      shapeType() {
        return this.colliderSet.raw.coShapeType(this.handle);
      }
      /**
       * The half-extents of this collider if it is a cuboid shape.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      halfExtents() {
        return VectorOps.fromRaw(this.colliderSet.raw.coHalfExtents(this.handle));
      }
      /**
       * Sets the half-extents of this collider if it is a cuboid shape.
       *
       * @param newHalfExtents - desired half extents.
       */
      setHalfExtents(newHalfExtents) {
        const rawPoint = VectorOps.intoRaw(newHalfExtents);
        this.colliderSet.raw.coSetHalfExtents(this.handle, rawPoint);
      }
      /**
       * The radius of this collider if it is a ball, cylinder, capsule, or cone shape.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      radius() {
        return this.colliderSet.raw.coRadius(this.handle);
      }
      /**
       * Sets the radius of this collider if it is a ball, cylinder, capsule, or cone shape.
       *
       * @param newRadius - desired radius.
       */
      setRadius(newRadius) {
        this.colliderSet.raw.coSetRadius(this.handle, newRadius);
      }
      /**
       * The radius of the round edges of this collider if it is a round cylinder.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      roundRadius() {
        return this.colliderSet.raw.coRoundRadius(this.handle);
      }
      /**
       * Sets the radius of the round edges of this collider if it has round edges.
       *
       * @param newBorderRadius - desired round edge radius.
       */
      setRoundRadius(newBorderRadius) {
        this.colliderSet.raw.coSetRoundRadius(this.handle, newBorderRadius);
      }
      /**
       * The half height of this collider if it is a cylinder, capsule, or cone shape.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      halfHeight() {
        return this.colliderSet.raw.coHalfHeight(this.handle);
      }
      /**
       * Sets the half height of this collider if it is a cylinder, capsule, or cone shape.
       *
       * @param newHalfheight - desired half height.
       */
      setHalfHeight(newHalfheight) {
        this.colliderSet.raw.coSetHalfHeight(this.handle, newHalfheight);
      }
      /**
       * If this collider has a triangle mesh, polyline, convex polygon, or convex polyhedron shape,
       * this returns the vertex buffer of said shape.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      vertices() {
        return this.colliderSet.raw.coVertices(this.handle);
      }
      /**
       * If this collider has a triangle mesh, polyline, or convex polyhedron shape,
       * this returns the index buffer of said shape.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      indices() {
        return this.colliderSet.raw.coIndices(this.handle);
      }
      /**
       * If this collider has a heightfield shape, this returns the heights buffer of
       * the heightfield.
       * In 3D, the returned height matrix is provided in column-major order.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      heightfieldHeights() {
        return this.colliderSet.raw.coHeightfieldHeights(this.handle);
      }
      /**
       * If this collider has a heightfield shape, this returns the scale
       * applied to it.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      heightfieldScale() {
        let scale = this.colliderSet.raw.coHeightfieldScale(this.handle);
        return VectorOps.fromRaw(scale);
      }
      // #if DIM3
      /**
       * If this collider has a heightfield shape, this returns the number of
       * rows of its height matrix.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      heightfieldNRows() {
        return this.colliderSet.raw.coHeightfieldNRows(this.handle);
      }
      /**
       * If this collider has a heightfield shape, this returns the number of
       * columns of its height matrix.
       * @deprecated this field will be removed in the future, please access this field on `shape` member instead.
       */
      heightfieldNCols() {
        return this.colliderSet.raw.coHeightfieldNCols(this.handle);
      }
      // #endif
      /**
       * The rigid-body this collider is attached to.
       */
      parent() {
        return this._parent;
      }
      /**
       * The friction coefficient of this collider.
       */
      friction() {
        return this.colliderSet.raw.coFriction(this.handle);
      }
      /**
       * The restitution coefficient of this collider.
       */
      restitution() {
        return this.colliderSet.raw.coRestitution(this.handle);
      }
      /**
       * The density of this collider.
       */
      density() {
        return this.colliderSet.raw.coDensity(this.handle);
      }
      /**
       * The mass of this collider.
       */
      mass() {
        return this.colliderSet.raw.coMass(this.handle);
      }
      /**
       * The volume of this collider.
       */
      volume() {
        return this.colliderSet.raw.coVolume(this.handle);
      }
      /**
       * The collision groups of this collider.
       */
      collisionGroups() {
        return this.colliderSet.raw.coCollisionGroups(this.handle);
      }
      /**
       * The solver groups of this collider.
       */
      solverGroups() {
        return this.colliderSet.raw.coSolverGroups(this.handle);
      }
      /**
       * Tests if this collider contains a point.
       *
       * @param point - The point to test.
       */
      containsPoint(point) {
        let rawPoint = VectorOps.intoRaw(point);
        let result = this.colliderSet.raw.coContainsPoint(this.handle, rawPoint);
        rawPoint.free();
        return result;
      }
      /**
       * Find the projection of a point on this collider.
       *
       * @param point - The point to project.
       * @param solid - If this is set to `true` then the collider shapes are considered to
       *   be plain (if the point is located inside of a plain shape, its projection is the point
       *   itself). If it is set to `false` the collider shapes are considered to be hollow
       *   (if the point is located inside of an hollow shape, it is projected on the shape's
       *   boundary).
       */
      projectPoint(point, solid) {
        let rawPoint = VectorOps.intoRaw(point);
        let result = PointProjection.fromRaw(this.colliderSet.raw.coProjectPoint(this.handle, rawPoint, solid));
        rawPoint.free();
        return result;
      }
      /**
       * Tests if this collider intersects the given ray.
       *
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       */
      intersectsRay(ray, maxToi) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let result = this.colliderSet.raw.coIntersectsRay(this.handle, rawOrig, rawDir, maxToi);
        rawOrig.free();
        rawDir.free();
        return result;
      }
      /*
       * Computes the smallest time between this and the given shape under translational movement are separated by a distance smaller or equal to distance.
       *
       * @param collider1Vel - The constant velocity of the current shape to cast (i.e. the cast direction).
       * @param shape2 - The shape to cast against.
       * @param shape2Pos - The position of the second shape.
       * @param shape2Rot - The rotation of the second shape.
       * @param shape2Vel - The constant velocity of the second shape.
       * @param targetDistance − If the shape moves closer to this distance from a collider, a hit
       *                         will be returned.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the distance traveled by the shape to `collider1Vel.norm() * maxToi`.
       * @param stopAtPenetration - If set to `false`, the linear shape-cast won’t immediately stop if
       *   the shape is penetrating another shape at its starting point **and** its trajectory is such
       *   that it’s on a path to exit that penetration state.
       */
      castShape(collider1Vel, shape2, shape2Pos, shape2Rot, shape2Vel, targetDistance, maxToi, stopAtPenetration) {
        let rawCollider1Vel = VectorOps.intoRaw(collider1Vel);
        let rawShape2Pos = VectorOps.intoRaw(shape2Pos);
        let rawShape2Rot = RotationOps.intoRaw(shape2Rot);
        let rawShape2Vel = VectorOps.intoRaw(shape2Vel);
        let rawShape2 = shape2.intoRaw();
        let result = ShapeCastHit.fromRaw(this.colliderSet, this.colliderSet.raw.coCastShape(this.handle, rawCollider1Vel, rawShape2, rawShape2Pos, rawShape2Rot, rawShape2Vel, targetDistance, maxToi, stopAtPenetration));
        rawCollider1Vel.free();
        rawShape2Pos.free();
        rawShape2Rot.free();
        rawShape2Vel.free();
        rawShape2.free();
        return result;
      }
      /*
       * Computes the smallest time between this and the given collider under translational movement are separated by a distance smaller or equal to distance.
       *
       * @param collider1Vel - The constant velocity of the current collider to cast (i.e. the cast direction).
       * @param collider2 - The collider to cast against.
       * @param collider2Vel - The constant velocity of the second collider.
       * @param targetDistance − If the shape moves closer to this distance from a collider, a hit
       *                         will be returned.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the distance traveled by the shape to `shapeVel.norm() * maxToi`.
       * @param stopAtPenetration - If set to `false`, the linear shape-cast won’t immediately stop if
       *   the shape is penetrating another shape at its starting point **and** its trajectory is such
       *   that it’s on a path to exit that penetration state.
       */
      castCollider(collider1Vel, collider2, collider2Vel, targetDistance, maxToi, stopAtPenetration) {
        let rawCollider1Vel = VectorOps.intoRaw(collider1Vel);
        let rawCollider2Vel = VectorOps.intoRaw(collider2Vel);
        let result = ColliderShapeCastHit.fromRaw(this.colliderSet, this.colliderSet.raw.coCastCollider(this.handle, rawCollider1Vel, collider2.handle, rawCollider2Vel, targetDistance, maxToi, stopAtPenetration));
        rawCollider1Vel.free();
        rawCollider2Vel.free();
        return result;
      }
      intersectsShape(shape2, shapePos2, shapeRot2) {
        let rawPos2 = VectorOps.intoRaw(shapePos2);
        let rawRot2 = RotationOps.intoRaw(shapeRot2);
        let rawShape2 = shape2.intoRaw();
        let result = this.colliderSet.raw.coIntersectsShape(this.handle, rawShape2, rawPos2, rawRot2);
        rawPos2.free();
        rawRot2.free();
        rawShape2.free();
        return result;
      }
      /**
       * Computes one pair of contact points between the shape owned by this collider and the given shape.
       *
       * @param shape2 - The second shape.
       * @param shape2Pos - The initial position of the second shape.
       * @param shape2Rot - The rotation of the second shape.
       * @param prediction - The prediction value, if the shapes are separated by a distance greater than this value, test will fail.
       * @returns `null` if the shapes are separated by a distance greater than prediction, otherwise contact details. The result is given in world-space.
       */
      contactShape(shape2, shape2Pos, shape2Rot, prediction) {
        let rawPos2 = VectorOps.intoRaw(shape2Pos);
        let rawRot2 = RotationOps.intoRaw(shape2Rot);
        let rawShape2 = shape2.intoRaw();
        let result = ShapeContact.fromRaw(this.colliderSet.raw.coContactShape(this.handle, rawShape2, rawPos2, rawRot2, prediction));
        rawPos2.free();
        rawRot2.free();
        rawShape2.free();
        return result;
      }
      /**
       * Computes one pair of contact points between the collider and the given collider.
       *
       * @param collider2 - The second collider.
       * @param prediction - The prediction value, if the shapes are separated by a distance greater than this value, test will fail.
       * @returns `null` if the shapes are separated by a distance greater than prediction, otherwise contact details. The result is given in world-space.
       */
      contactCollider(collider2, prediction) {
        let result = ShapeContact.fromRaw(this.colliderSet.raw.coContactCollider(this.handle, collider2.handle, prediction));
        return result;
      }
      /**
       * Find the closest intersection between a ray and this collider.
       *
       * This also computes the normal at the hit point.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       * @returns The time-of-impact between this collider and the ray, or `-1` if there is no intersection.
       */
      castRay(ray, maxToi, solid) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let result = this.colliderSet.raw.coCastRay(this.handle, rawOrig, rawDir, maxToi, solid);
        rawOrig.free();
        rawDir.free();
        return result;
      }
      /**
       * Find the closest intersection between a ray and this collider.
       *
       * This also computes the normal at the hit point.
       * @param ray - The ray to cast.
       * @param maxToi - The maximum time-of-impact that can be reported by this cast. This effectively
       *   limits the length of the ray to `ray.dir.norm() * maxToi`.
       * @param solid - If `false` then the ray will attempt to hit the boundary of a shape, even if its
       *   origin already lies inside of a shape. In other terms, `true` implies that all shapes are plain,
       *   whereas `false` implies that all shapes are hollow for this ray-cast.
       */
      castRayAndGetNormal(ray, maxToi, solid) {
        let rawOrig = VectorOps.intoRaw(ray.origin);
        let rawDir = VectorOps.intoRaw(ray.dir);
        let result = RayIntersection.fromRaw(this.colliderSet.raw.coCastRayAndGetNormal(this.handle, rawOrig, rawDir, maxToi, solid));
        rawOrig.free();
        rawDir.free();
        return result;
      }
    };
    (function(MassPropsMode2) {
      MassPropsMode2[MassPropsMode2["Density"] = 0] = "Density";
      MassPropsMode2[MassPropsMode2["Mass"] = 1] = "Mass";
      MassPropsMode2[MassPropsMode2["MassProps"] = 2] = "MassProps";
    })(MassPropsMode || (MassPropsMode = {}));
    ColliderDesc = class _ColliderDesc {
      /**
       * Initializes a collider descriptor from the collision shape.
       *
       * @param shape - The shape of the collider being built.
       */
      constructor(shape) {
        this.enabled = true;
        this.shape = shape;
        this.massPropsMode = MassPropsMode.Density;
        this.density = 1;
        this.friction = 0.5;
        this.restitution = 0;
        this.rotation = RotationOps.identity();
        this.translation = VectorOps.zeros();
        this.isSensor = false;
        this.collisionGroups = 4294967295;
        this.solverGroups = 4294967295;
        this.frictionCombineRule = CoefficientCombineRule.Average;
        this.restitutionCombineRule = CoefficientCombineRule.Average;
        this.activeCollisionTypes = ActiveCollisionTypes.DEFAULT;
        this.activeEvents = ActiveEvents.NONE;
        this.activeHooks = ActiveHooks.NONE;
        this.mass = 0;
        this.centerOfMass = VectorOps.zeros();
        this.contactForceEventThreshold = 0;
        this.contactSkin = 0;
        this.principalAngularInertia = VectorOps.zeros();
        this.angularInertiaLocalFrame = RotationOps.identity();
      }
      /**
       * Create a new collider descriptor with a ball shape.
       *
       * @param radius - The radius of the ball.
       */
      static ball(radius) {
        const shape = new Ball(radius);
        return new _ColliderDesc(shape);
      }
      /**
       * Create a new collider descriptor with a capsule shape.
       *
       * @param halfHeight - The half-height of the capsule, along the `y` axis.
       * @param radius - The radius of the capsule basis.
       */
      static capsule(halfHeight, radius) {
        const shape = new Capsule(halfHeight, radius);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new segment shape.
       *
       * @param a - The first point of the segment.
       * @param b - The second point of the segment.
       */
      static segment(a, b) {
        const shape = new Segment(a, b);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new triangle shape.
       *
       * @param a - The first point of the triangle.
       * @param b - The second point of the triangle.
       * @param c - The third point of the triangle.
       */
      static triangle(a, b, c) {
        const shape = new Triangle(a, b, c);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new triangle shape with round corners.
       *
       * @param a - The first point of the triangle.
       * @param b - The second point of the triangle.
       * @param c - The third point of the triangle.
       * @param borderRadius - The radius of the borders of this triangle. In 3D,
       *   this is also equal to half the thickness of the triangle.
       */
      static roundTriangle(a, b, c, borderRadius) {
        const shape = new RoundTriangle(a, b, c, borderRadius);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor with a polyline shape.
       *
       * @param vertices - The coordinates of the polyline's vertices.
       * @param indices - The indices of the polyline's segments. If this is `undefined` or `null`,
       *    the vertices are assumed to describe a line strip.
       */
      static polyline(vertices, indices) {
        const shape = new Polyline(vertices, indices);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor with a triangle mesh shape.
       *
       * @param vertices - The coordinates of the triangle mesh's vertices.
       * @param indices - The indices of the triangle mesh's triangles.
       */
      static trimesh(vertices, indices, flags) {
        const shape = new TriMesh(vertices, indices, flags);
        return new _ColliderDesc(shape);
      }
      // #if DIM3
      /**
       * Creates a new collider descriptor with a cuboid shape.
       *
       * @param hx - The half-width of the rectangle along its local `x` axis.
       * @param hy - The half-width of the rectangle along its local `y` axis.
       * @param hz - The half-width of the rectangle along its local `z` axis.
       */
      static cuboid(hx, hy, hz) {
        const shape = new Cuboid(hx, hy, hz);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor with a rectangular shape with round borders.
       *
       * @param hx - The half-width of the rectangle along its local `x` axis.
       * @param hy - The half-width of the rectangle along its local `y` axis.
       * @param hz - The half-width of the rectangle along its local `z` axis.
       * @param borderRadius - The radius of the cuboid's borders.
       */
      static roundCuboid(hx, hy, hz, borderRadius) {
        const shape = new RoundCuboid(hx, hy, hz, borderRadius);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor with a heightfield shape.
       *
       * @param nrows − The number of rows in the heights matrix.
       * @param ncols - The number of columns in the heights matrix.
       * @param heights - The heights of the heightfield along its local `y` axis,
       *                  provided as a matrix stored in column-major order.
       * @param scale - The scale factor applied to the heightfield.
       */
      static heightfield(nrows, ncols, heights, scale, flags) {
        const shape = new Heightfield(nrows, ncols, heights, scale, flags);
        return new _ColliderDesc(shape);
      }
      /**
       * Create a new collider descriptor with a cylinder shape.
       *
       * @param halfHeight - The half-height of the cylinder, along the `y` axis.
       * @param radius - The radius of the cylinder basis.
       */
      static cylinder(halfHeight, radius) {
        const shape = new Cylinder(halfHeight, radius);
        return new _ColliderDesc(shape);
      }
      /**
       * Create a new collider descriptor with a cylinder shape with rounded corners.
       *
       * @param halfHeight - The half-height of the cylinder, along the `y` axis.
       * @param radius - The radius of the cylinder basis.
       * @param borderRadius - The radius of the cylinder's rounded edges and vertices.
       */
      static roundCylinder(halfHeight, radius, borderRadius) {
        const shape = new RoundCylinder(halfHeight, radius, borderRadius);
        return new _ColliderDesc(shape);
      }
      /**
       * Create a new collider descriptor with a cone shape.
       *
       * @param halfHeight - The half-height of the cone, along the `y` axis.
       * @param radius - The radius of the cone basis.
       */
      static cone(halfHeight, radius) {
        const shape = new Cone(halfHeight, radius);
        return new _ColliderDesc(shape);
      }
      /**
       * Create a new collider descriptor with a cone shape with rounded corners.
       *
       * @param halfHeight - The half-height of the cone, along the `y` axis.
       * @param radius - The radius of the cone basis.
       * @param borderRadius - The radius of the cone's rounded edges and vertices.
       */
      static roundCone(halfHeight, radius, borderRadius) {
        const shape = new RoundCone(halfHeight, radius, borderRadius);
        return new _ColliderDesc(shape);
      }
      /**
       * Computes the convex-hull of the given points and use the resulting
       * convex polyhedron as the shape for this new collider descriptor.
       *
       * @param points - The point that will be used to compute the convex-hull.
       */
      static convexHull(points) {
        const shape = new ConvexPolyhedron(points, null);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor that uses the given set of points assumed
       * to form a convex polyline (no convex-hull computation will be done).
       *
       * @param vertices - The vertices of the convex polyline.
       */
      static convexMesh(vertices, indices) {
        const shape = new ConvexPolyhedron(vertices, indices);
        return new _ColliderDesc(shape);
      }
      /**
       * Computes the convex-hull of the given points and use the resulting
       * convex polyhedron as the shape for this new collider descriptor. A
       * border is added to that convex polyhedron to give it round corners.
       *
       * @param points - The point that will be used to compute the convex-hull.
       * @param borderRadius - The radius of the round border added to the convex polyhedron.
       */
      static roundConvexHull(points, borderRadius) {
        const shape = new RoundConvexPolyhedron(points, null, borderRadius);
        return new _ColliderDesc(shape);
      }
      /**
       * Creates a new collider descriptor that uses the given set of points assumed
       * to form a round convex polyline (no convex-hull computation will be done).
       *
       * @param vertices - The vertices of the convex polyline.
       * @param borderRadius - The radius of the round border added to the convex polyline.
       */
      static roundConvexMesh(vertices, indices, borderRadius) {
        const shape = new RoundConvexPolyhedron(vertices, indices, borderRadius);
        return new _ColliderDesc(shape);
      }
      // #endif
      // #if DIM3
      /**
       * Sets the position of the collider to be created relative to the rigid-body it is attached to.
       */
      setTranslation(x, y, z) {
        if (typeof x != "number" || typeof y != "number" || typeof z != "number")
          throw TypeError("The translation components must be numbers.");
        this.translation = { x, y, z };
        return this;
      }
      // #endif
      /**
       * Sets the rotation of the collider to be created relative to the rigid-body it is attached to.
       *
       * @param rot - The rotation of the collider to be created relative to the rigid-body it is attached to.
       */
      setRotation(rot) {
        RotationOps.copy(this.rotation, rot);
        return this;
      }
      /**
       * Sets whether or not the collider being created is a sensor.
       *
       * A sensor collider does not take part of the physics simulation, but generates
       * proximity events.
       *
       * @param sensor - Set to `true` of the collider built is to be a sensor.
       */
      setSensor(sensor) {
        this.isSensor = sensor;
        return this;
      }
      /**
       * Sets whether the created collider will be enabled or disabled.
       * @param enabled − If set to `false` the collider will be disabled at creation.
       */
      setEnabled(enabled) {
        this.enabled = enabled;
        return this;
      }
      /**
       * Sets the contact skin of the collider.
       *
       * The contact skin acts as if the collider was enlarged with a skin of width `skin_thickness`
       * around it, keeping objects further apart when colliding.
       *
       * A non-zero contact skin can increase performance, and in some cases, stability. However
       * it creates a small gap between colliding object (equal to the sum of their skin). If the
       * skin is sufficiently small, this might not be visually significant or can be hidden by the
       * rendering assets.
       */
      setContactSkin(thickness) {
        this.contactSkin = thickness;
        return this;
      }
      /**
       * Sets the density of the collider being built.
       *
       * The mass and angular inertia tensor will be computed automatically based on this density and the collider’s shape.
       *
       * @param density - The density to set, must be greater or equal to 0. A density of 0 means that this collider
       *                  will not affect the mass or angular inertia of the rigid-body it is attached to.
       */
      setDensity(density) {
        this.massPropsMode = MassPropsMode.Density;
        this.density = density;
        return this;
      }
      /**
       * Sets the mass of the collider being built.
       *
       * The angular inertia tensor will be computed automatically based on this mass and the collider’s shape.
       *
       * @param mass - The mass to set, must be greater or equal to 0.
       */
      setMass(mass) {
        this.massPropsMode = MassPropsMode.Mass;
        this.mass = mass;
        return this;
      }
      // #if DIM3
      /**
       * Sets the mass properties of the collider being built.
       *
       * This replaces the mass-properties automatically computed from the collider's density and shape.
       * These mass-properties will be added to the mass-properties of the rigid-body this collider will be attached to.
       *
       * @param mass − The mass of the collider to create.
       * @param centerOfMass − The center-of-mass of the collider to create.
       * @param principalAngularInertia − The initial principal angular inertia of the collider to create.
       *                                  These are the eigenvalues of the angular inertia matrix.
       * @param angularInertiaLocalFrame − The initial local angular inertia frame of the collider to create.
       *                                   These are the eigenvectors of the angular inertia matrix.
       */
      setMassProperties(mass, centerOfMass, principalAngularInertia, angularInertiaLocalFrame) {
        this.massPropsMode = MassPropsMode.MassProps;
        this.mass = mass;
        VectorOps.copy(this.centerOfMass, centerOfMass);
        VectorOps.copy(this.principalAngularInertia, principalAngularInertia);
        RotationOps.copy(this.angularInertiaLocalFrame, angularInertiaLocalFrame);
        return this;
      }
      // #endif
      /**
       * Sets the restitution coefficient of the collider to be created.
       *
       * @param restitution - The restitution coefficient in `[0, 1]`. A value of 0 (the default) means no bouncing behavior
       *                   while 1 means perfect bouncing (though energy may still be lost due to numerical errors of the
       *                   constraints solver).
       */
      setRestitution(restitution) {
        this.restitution = restitution;
        return this;
      }
      /**
       * Sets the friction coefficient of the collider to be created.
       *
       * @param friction - The friction coefficient. Must be greater or equal to 0. This is generally smaller than 1. The
       *                   higher the coefficient, the stronger friction forces will be for contacts with the collider
       *                   being built.
       */
      setFriction(friction) {
        this.friction = friction;
        return this;
      }
      /**
       * Sets the rule used to combine the friction coefficients of two colliders
       * colliders involved in a contact.
       *
       * @param rule − The combine rule to apply.
       */
      setFrictionCombineRule(rule) {
        this.frictionCombineRule = rule;
        return this;
      }
      /**
       * Sets the rule used to combine the restitution coefficients of two colliders
       * colliders involved in a contact.
       *
       * @param rule − The combine rule to apply.
       */
      setRestitutionCombineRule(rule) {
        this.restitutionCombineRule = rule;
        return this;
      }
      /**
       * Sets the collision groups used by this collider.
       *
       * Two colliders will interact iff. their collision groups are compatible.
       * See the documentation of `InteractionGroups` for details on teh used bit pattern.
       *
       * @param groups - The collision groups used for the collider being built.
       */
      setCollisionGroups(groups) {
        this.collisionGroups = groups;
        return this;
      }
      /**
       * Sets the solver groups used by this collider.
       *
       * Forces between two colliders in contact will be computed iff their solver
       * groups are compatible.
       * See the documentation of `InteractionGroups` for details on the used bit pattern.
       *
       * @param groups - The solver groups used for the collider being built.
       */
      setSolverGroups(groups) {
        this.solverGroups = groups;
        return this;
      }
      /**
       * Set the physics hooks active for this collider.
       *
       * Use this to enable custom filtering rules for contact/intersecstion pairs involving this collider.
       *
       * @param activeHooks - The hooks active for contact/intersection pairs involving this collider.
       */
      setActiveHooks(activeHooks) {
        this.activeHooks = activeHooks;
        return this;
      }
      /**
       * Set the events active for this collider.
       *
       * Use this to enable contact and/or intersection event reporting for this collider.
       *
       * @param activeEvents - The events active for contact/intersection pairs involving this collider.
       */
      setActiveEvents(activeEvents) {
        this.activeEvents = activeEvents;
        return this;
      }
      /**
       * Set the collision types active for this collider.
       *
       * @param activeCollisionTypes - The hooks active for contact/intersection pairs involving this collider.
       */
      setActiveCollisionTypes(activeCollisionTypes) {
        this.activeCollisionTypes = activeCollisionTypes;
        return this;
      }
      /**
       * Sets the total force magnitude beyond which a contact force event can be emitted.
       *
       * @param threshold - The force threshold to set.
       */
      setContactForceEventThreshold(threshold) {
        this.contactForceEventThreshold = threshold;
        return this;
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/collider_set.js
var ColliderSet;
var init_collider_set = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/collider_set.js"() {
    init_raw();
    init_coarena();
    init_math();
    init_collider();
    ColliderSet = class {
      constructor(raw) {
        this.raw = raw || new RawColliderSet();
        this.map = new Coarena();
        if (raw) {
          raw.forEachColliderHandle((handle) => {
            this.map.set(handle, new Collider(this, handle, null));
          });
        }
      }
      /**
       * Release the WASM memory occupied by this collider set.
       */
      free() {
        if (!!this.raw) {
          this.raw.free();
        }
        this.raw = void 0;
        if (!!this.map) {
          this.map.clear();
        }
        this.map = void 0;
      }
      /** @internal */
      castClosure(f) {
        return (handle) => {
          if (!!f) {
            return f(this.get(handle));
          } else {
            return void 0;
          }
        };
      }
      /** @internal */
      finalizeDeserialization(bodies) {
        this.map.forEach((collider) => collider.finalizeDeserialization(bodies));
      }
      /**
       * Creates a new collider and return its integer handle.
       *
       * @param bodies - The set of bodies where the collider's parent can be found.
       * @param desc - The collider's description.
       * @param parentHandle - The integer handle of the rigid-body this collider is attached to.
       */
      createCollider(bodies, desc, parentHandle) {
        let hasParent = parentHandle != void 0 && parentHandle != null;
        if (hasParent && isNaN(parentHandle))
          throw Error("Cannot create a collider with a parent rigid-body handle that is not a number.");
        let rawShape = desc.shape.intoRaw();
        let rawTra = VectorOps.intoRaw(desc.translation);
        let rawRot = RotationOps.intoRaw(desc.rotation);
        let rawCom = VectorOps.intoRaw(desc.centerOfMass);
        let rawPrincipalInertia = VectorOps.intoRaw(desc.principalAngularInertia);
        let rawInertiaFrame = RotationOps.intoRaw(desc.angularInertiaLocalFrame);
        let handle = this.raw.createCollider(
          desc.enabled,
          rawShape,
          rawTra,
          rawRot,
          desc.massPropsMode,
          desc.mass,
          rawCom,
          // #if DIM3
          rawPrincipalInertia,
          rawInertiaFrame,
          // #endif
          desc.density,
          desc.friction,
          desc.restitution,
          desc.frictionCombineRule,
          desc.restitutionCombineRule,
          desc.isSensor,
          desc.collisionGroups,
          desc.solverGroups,
          desc.activeCollisionTypes,
          desc.activeHooks,
          desc.activeEvents,
          desc.contactForceEventThreshold,
          desc.contactSkin,
          hasParent,
          hasParent ? parentHandle : 0,
          bodies.raw
        );
        rawShape.free();
        rawTra.free();
        rawRot.free();
        rawCom.free();
        rawPrincipalInertia.free();
        rawInertiaFrame.free();
        let parent = hasParent ? bodies.get(parentHandle) : null;
        let collider = new Collider(this, handle, parent, desc.shape);
        this.map.set(handle, collider);
        return collider;
      }
      /**
       * Remove a collider from this set.
       *
       * @param handle - The integer handle of the collider to remove.
       * @param bodies - The set of rigid-body containing the rigid-body the collider is attached to.
       * @param wakeUp - If `true`, the rigid-body the removed collider is attached to will be woken-up automatically.
       */
      remove(handle, islands, bodies, wakeUp) {
        this.raw.remove(handle, islands.raw, bodies.raw, wakeUp);
        this.unmap(handle);
      }
      /**
       * Internal function, do not call directly.
       * @param handle
       */
      unmap(handle) {
        this.map.delete(handle);
      }
      /**
       * Gets the rigid-body with the given handle.
       *
       * @param handle - The handle of the rigid-body to retrieve.
       */
      get(handle) {
        return this.map.get(handle);
      }
      /**
       * The number of colliders on this set.
       */
      len() {
        return this.map.len();
      }
      /**
       * Does this set contain a collider with the given handle?
       *
       * @param handle - The collider handle to check.
       */
      contains(handle) {
        return this.get(handle) != null;
      }
      /**
       * Applies the given closure to each collider contained by this set.
       *
       * @param f - The closure to apply.
       */
      forEach(f) {
        this.map.forEach(f);
      }
      /**
       * Gets all colliders in the list.
       *
       * @returns collider list.
       */
      getAll() {
        return this.map.getAll();
      }
    };
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/interaction_groups.js
var init_interaction_groups = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/interaction_groups.js"() {
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/geometry/index.js
var init_geometry = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/geometry/index.js"() {
    init_broad_phase();
    init_narrow_phase();
    init_shape();
    init_collider();
    init_collider_set();
    init_feature();
    init_ray();
    init_point();
    init_toi();
    init_interaction_groups();
    init_contact();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/init.js
var init_init = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/init.js"() {
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/exports.js
var exports_exports = {};
__export(exports_exports, {
  ActiveCollisionTypes: () => ActiveCollisionTypes,
  ActiveEvents: () => ActiveEvents,
  ActiveHooks: () => ActiveHooks,
  Ball: () => Ball,
  BroadPhase: () => BroadPhase,
  CCDSolver: () => CCDSolver,
  Capsule: () => Capsule,
  CharacterCollision: () => CharacterCollision,
  CoefficientCombineRule: () => CoefficientCombineRule,
  Collider: () => Collider,
  ColliderDesc: () => ColliderDesc,
  ColliderSet: () => ColliderSet,
  ColliderShapeCastHit: () => ColliderShapeCastHit,
  Cone: () => Cone,
  ConvexPolyhedron: () => ConvexPolyhedron,
  Cuboid: () => Cuboid,
  Cylinder: () => Cylinder,
  DebugRenderBuffers: () => DebugRenderBuffers,
  DebugRenderPipeline: () => DebugRenderPipeline,
  DynamicRayCastVehicleController: () => DynamicRayCastVehicleController,
  EventQueue: () => EventQueue,
  FeatureType: () => FeatureType,
  FixedImpulseJoint: () => FixedImpulseJoint,
  FixedMultibodyJoint: () => FixedMultibodyJoint,
  GenericImpulseJoint: () => GenericImpulseJoint,
  HalfSpace: () => HalfSpace,
  HeightFieldFlags: () => HeightFieldFlags,
  Heightfield: () => Heightfield,
  ImpulseJoint: () => ImpulseJoint,
  ImpulseJointSet: () => ImpulseJointSet,
  IntegrationParameters: () => IntegrationParameters,
  IslandManager: () => IslandManager,
  JointAxesMask: () => JointAxesMask,
  JointData: () => JointData,
  JointType: () => JointType,
  KinematicCharacterController: () => KinematicCharacterController,
  MassPropsMode: () => MassPropsMode,
  MotorModel: () => MotorModel,
  MultibodyJoint: () => MultibodyJoint,
  MultibodyJointSet: () => MultibodyJointSet,
  NarrowPhase: () => NarrowPhase,
  PhysicsPipeline: () => PhysicsPipeline,
  PointColliderProjection: () => PointColliderProjection,
  PointProjection: () => PointProjection,
  Polyline: () => Polyline,
  PrismaticImpulseJoint: () => PrismaticImpulseJoint,
  PrismaticMultibodyJoint: () => PrismaticMultibodyJoint,
  Quaternion: () => Quaternion,
  QueryFilterFlags: () => QueryFilterFlags,
  QueryPipeline: () => QueryPipeline,
  Ray: () => Ray,
  RayColliderHit: () => RayColliderHit,
  RayColliderIntersection: () => RayColliderIntersection,
  RayIntersection: () => RayIntersection,
  RevoluteImpulseJoint: () => RevoluteImpulseJoint,
  RevoluteMultibodyJoint: () => RevoluteMultibodyJoint,
  RigidBody: () => RigidBody,
  RigidBodyDesc: () => RigidBodyDesc,
  RigidBodySet: () => RigidBodySet,
  RigidBodyType: () => RigidBodyType,
  RopeImpulseJoint: () => RopeImpulseJoint,
  RotationOps: () => RotationOps,
  RoundCone: () => RoundCone,
  RoundConvexPolyhedron: () => RoundConvexPolyhedron,
  RoundCuboid: () => RoundCuboid,
  RoundCylinder: () => RoundCylinder,
  RoundTriangle: () => RoundTriangle,
  SdpMatrix3: () => SdpMatrix3,
  SdpMatrix3Ops: () => SdpMatrix3Ops,
  Segment: () => Segment,
  SerializationPipeline: () => SerializationPipeline,
  Shape: () => Shape,
  ShapeCastHit: () => ShapeCastHit,
  ShapeContact: () => ShapeContact,
  ShapeType: () => ShapeType,
  SolverFlags: () => SolverFlags,
  SphericalImpulseJoint: () => SphericalImpulseJoint,
  SphericalMultibodyJoint: () => SphericalMultibodyJoint,
  SpringImpulseJoint: () => SpringImpulseJoint,
  TempContactForceEvent: () => TempContactForceEvent,
  TempContactManifold: () => TempContactManifold,
  TriMesh: () => TriMesh,
  TriMeshFlags: () => TriMeshFlags,
  Triangle: () => Triangle,
  UnitImpulseJoint: () => UnitImpulseJoint,
  UnitMultibodyJoint: () => UnitMultibodyJoint,
  Vector3: () => Vector3,
  VectorOps: () => VectorOps,
  World: () => World,
  version: () => version2
});
function version2() {
  return version();
}
var init_exports = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/exports.js"() {
    init_raw();
    init_math();
    init_dynamics();
    init_geometry();
    init_pipeline();
    init_init();
    init_control();
  }
});

// ../全新的游戏/node_modules/@dimforge/rapier3d/rapier.js
var rapier_default;
var init_rapier = __esm({
  "../\u5168\u65B0\u7684\u6E38\u620F/node_modules/@dimforge/rapier3d/rapier.js"() {
    init_exports();
    init_exports();
    rapier_default = exports_exports;
  }
});

// src/core/ragdoll.ts
var ragdoll_exports = {};
__export(ragdoll_exports, {
  Ragdoll: () => Ragdoll
});
function quatRotate(qx, qy, qz, qw, vx, vy, vz, out) {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
function quatInvRotate(qx, qy, qz, qw, vx, vy, vz, out) {
  quatRotate(-qx, -qy, -qz, qw, vx, vy, vz, out);
}
function quatRel2(ax, ay, az, aw, bx, by, bz, bw, out) {
  const cx = -ax, cy = -ay, cz = -az, cw = aw;
  out[0] = cw * bx + cx * bw + cy * bz - cz * by;
  out[1] = cw * by - cx * bz + cy * bw + cz * bx;
  out[2] = cw * bz + cx * by - cy * bx + cz * bw;
  out[3] = cw * bw - cx * bx - cy * by - cz * bz;
}
function quatToRotVec2(qx, qy, qz, qw, out) {
  const w = qw > 1 ? 1 : qw < -1 ? -1 : qw;
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (s < 1e-7) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const ang = 2 * half;
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  out[0] = qx * k;
  out[1] = qy * k;
  out[2] = qz * k;
}
function calcJointRot(qpx, qpy, qpz, qpw, qcx, qcy, qcz, qcw, tmp4, out) {
  quatRel2(qpx, qpy, qpz, qpw, qcx, qcy, qcz, qcw, tmp4);
  quatToRotVec2(tmp4[0], tmp4[1], tmp4[2], tmp4[3], out);
}
function calcJointRelVel(qpx, qpy, qpz, qpw, rx, ry, rz, out) {
  quatInvRotate(qpx, qpy, qpz, qpw, rx, ry, rz, out);
}
var MEM_GROUND, MEM_SELF, GROUPS_SELF, GROUPS_GROUND, IDENTITY, ZERO, MOTOR_ALPHA, MOTOR_ALPHA_RECOVER, LIMIT_SOFT_ZONE, AXIS_X, AXIS_Y, DEFAULTS, Ragdoll;
var init_ragdoll = __esm({
  "src/core/ragdoll.ts"() {
    "use strict";
    init_rapier();
    init_skeleton();
    MEM_GROUND = 1;
    MEM_SELF = 2;
    GROUPS_SELF = (MEM_SELF << 16 | MEM_GROUND) >>> 0;
    GROUPS_GROUND = (MEM_GROUND << 16 | MEM_SELF) >>> 0;
    IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
    ZERO = { x: 0, y: 0, z: 0 };
    MOTOR_ALPHA = 1;
    MOTOR_ALPHA_RECOVER = 1;
    LIMIT_SOFT_ZONE = 0.3;
    AXIS_X = 0;
    AXIS_Y = 1;
    DEFAULTS = {
      groundFriction: 1,
      bodyFriction: 0.9,
      linearDamping: 0,
      angularDamping: 0.04,
      torqueScale: 1,
      kP: 48,
      kD: 1,
      // 逐关节增益：默认空（全部用上面的全局值）
      jointGain: {},
      posRefScale: 0.9,
      purgeJointCache: true,
      motorAlpha: MOTOR_ALPHA,
      ankleGroundFactor: 20
      // ★ 默认 1 = 不放大（保持重构前的行为）。放大必须先重调踝的 PD/惯量，见 probe-ankle
    };
    Ragdoll = class _Ragdoll {
      sk;
      opt;
      bodies = [];
      /** [左, 右] 鞋底 collider（腾空时间/单脚支撑的真实接触判据） */
      soleCol = [null, null];
      /** `readCoP` 的复用缓冲：[copX, copY, copZ, Σλ] */
      copTmp = new Float64Array(4);
      /**
       * ★★ **每轴权限**：`driveMotors` 的稳定性护栏放行了百分之多少（0~1）。
       *   1 = 完全放行；<1 = 冲量被 `α·|err|·Ieff` 卡住。
       *   必须可回读：**"马达没力"和"指令太小"在别的指标里看起来一模一样**
       *   （历史事故：踝只能出 3% 的力矩，而存活/倾角指标全都"正常"）。
       */
      motorAuthority;
      /** 接地时 Ieff 的放大倍数（踝专用；离地时用 1） */
      groundFactor;
      /** ★ 每次 reset 都会整体重建（见 purgeJointCache），所以别缓存元素引用 */
      joints = [];
      /** key → 刚体下标 */
      indexByKey = /* @__PURE__ */ new Map();
      /**
       * ★ 身体参考点的刚体 key = 脊柱最上一段（胸腔）。K=1 时就是 'torso'。
       * 见 torso() 的注释 —— 分段之后"树根"是骨盆，但状态量要以胸腔为基准。
       */
      torsoKey;
      /** 关节 i → [父刚体下标, 子刚体下标] */
      jointBodies;
      /**
       * 关节 i 的等效惯量（单位冲量造成的相对角速度变化 = 1/Ieff），构造时算一次。
       * ★ 3D 版取两个刚体**三个主惯量的最小值**再合成 —— 偏保守。
       *   （绕某轴转的惯量 ≥ 主惯量最小值，用最小值 ⇒ 允许的冲量偏小 ⇒ 不会引入不稳定。）
       */
      jointIeff;
      /**
       * 关节目标**角**命令（无量纲，∈ [−1, 1]，长度 = 关节数 × 3）。
       * ★ 语义已从"目标角速度系数"改成"目标角系数"（见 RagdollOptions.posRefScale）：
       *   由 setMotorTargets 写入，driveMotors 里映射成 θ_ref = cmd × 该侧量程 × posRefScale。
       * 只存不施加 —— 真正的力矩在 driveMotors() 里按物理步施加。
       */
      motorTarget;
      /**
       * 每个可驱动轴的 θ_ref 斜率：cmd > 0 时用 refPos，cmd < 0 时用 refNeg。
       * 两者都取正数 —— 因为 hi 可能很小（膝 +2°）、lo 很负（膝 −145°），
       * 必须各按自己的量程走，才能同时保住 `cmd = 0 ⇒ θ_ref = 0`。见 posRefScale。
       */
      refPos;
      refNeg;
      /**
       * ★ 上一次 driveMotors 里**实际施加**到子刚体上的马达冲量（N·m·s），每关节 3 个轴。
       *
       * 存在的意义：Rapier 0.14 的 wasm 绑定里**完全没有关节冲量/反力的读回接口**
       * （rawimpulsejointset_* 只有 jointType / anchor / limits / motor 配置，没有 impulse）。
       * 所以"各个组件受力"只能靠**我们自己记账 + 牛顿定律重建**：
       *   · 马达力矩 —— 这个文件自己施加的，直接记下来（本数组）
       *   · 地面接触力 —— 从接触流形 contactImpulse + normal 读
       *   · 关节反作用力 —— 用"子树动量收支"反推（见 tools/probe-forces.ts C 段）
       * 除以 dt 就是力矩（N·m）。
       */
      motorImpulse;
      /** ★ 逐轴限位触发次数（诊断用：>0 说明限位真的在起作用） */
      limitHits = 0;
      /**
       * ★★ 本步**想要**施加的力矩（N·m）—— 即被 `α·|err|·Ieff` 稳定性上限削掉**之前**的值。
       *
       * 为什么必须和 motorImpulse 成对存在（这是"关节明明有力却撑不住"的头号嫌疑的判据）：
       *   本文件的稳定性护栏 `|imp| ≤ α·|err|·Ieff` 是**正比于误差**的 ⇒ 它给出的有效力矩上限是
       *
       *       τ_max_eff = α · kP · Δθ · Ieff / dt
       *
       *   对髋外展轴（Ieff ≈ 0.083）在 α=0.35 时只有 ~31 N·m/rad ⇒ 就算关节差 45°（0.785 rad），
       *   也只出得了 ~25 N·m，而髋的**声明**力矩是 120 N·m（外展）—— **只用了 20%**。
       *   （α 提到 1.0 之后这个比例回到 ~75%，见 MOTOR_ALPHA 的长注释。）
       *   只看 motorImpulse 是看不出这件事的（它已经是被削过的值，看起来"很合理"）；
       *   必须和 motorDemand 相除才能回答"是没力气，还是不敢用力"。
       */
      motorDemand;
      world;
      initX;
      initY;
      initZ;
      /** 各刚体的静姿态四元数（reset 用 + 关节角的参考系） */
      restQ;
      // ---- 热路径复用缓冲（零分配） ----
      qRel = new Float64Array(4);
      rv = new Float64Array(3);
      relL = new Float64Array(3);
      axisW = new Float64Array(3);
      /** tiltOf / headingOf 的独立 scratch（别和 rv 共用，否则嵌套调用会串） */
      dirTmp = new Float64Array(3);
      /** applyTorqueImpulse 的复用向量（wasm 侧只读，复用安全） */
      iv = { x: 0, y: 0, z: 0 };
      /** ★ 是否启用**虚拟支撑点**。默认 **关** —— 用户 2026-10-02 反馈"支撑腿打滑的感觉"，
       *   原因是支撑点在脚刚体上直接施加冲量、**绕过接触与摩擦**。
       *   纯物理路径（靠踝力矩把脚撬起来让接触自然算 CoP）才是不打滑的做法。 */
      supportPointOn = false;
      /** 最近一次 driveMotors 的 dt（enforceLimits 的角度投影需要它换算角冲量）。 */
      lastDt = 1 / 120;
      axTmp = new Float64Array(3);
      ptTmp = { x: 0, y: 0, z: 0 };
      pcTmp = { x: 0, y: 0, z: 0 };
      ivUp = { x: 0, y: 0, z: 0 };
      constructor(world, sk2, opt = {}) {
        this.world = world;
        this.sk = sk2;
        this.opt = { ...DEFAULTS, ...opt };
        for (const key of Object.keys(opt)) {
          if (!(key in DEFAULTS)) {
            console.warn(`[ragdoll] \u26A0 \u672A\u77E5\u914D\u7F6E\u9879 "${key}" \u88AB\u5FFD\u7565\uFF08\u662F\u4E0D\u662F\u6539\u540D\u4E86\uFF1F\u89C1 RagdollOptions\uFF09`);
          }
        }
        this.motorTarget = new Float32Array(sk2.joints.length * 3);
        this.motorImpulse = new Float64Array(sk2.joints.length * 3);
        this.motorDemand = new Float64Array(sk2.joints.length * 3);
        this.motorAuthority = new Float32Array(sk2.joints.length * 3);
        this.groundFactor = new Float32Array(sk2.joints.length).fill(1);
        this.footAuthUsed = new Float32Array(sk2.joints.length * 3).fill(1);
        this.ankleGroundFactorUsed = new Float32Array(sk2.joints.length).fill(1);
        this.ankleJoint = jointIndexByName(sk2, "foot_l");
        this.ankleJointR = jointIndexByName(sk2, "foot_r");
        let topSpine = -1;
        for (const b of sk2.bodies) {
          const m = /^spine(\d+)$/.exec(b.key);
          if (m) topSpine = Math.max(topSpine, Number(m[1]));
        }
        this.torsoKey = topSpine > 0 ? `spine${topSpine}` : "torso";
        const ground = this.world.createRigidBody(rapier_default.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
        this.world.createCollider(
          rapier_default.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(this.opt.groundFriction).setCollisionGroups(GROUPS_GROUND),
          ground
        );
        this.initX = new Float64Array(sk2.bodies.length);
        this.initY = new Float64Array(sk2.bodies.length);
        this.initZ = new Float64Array(sk2.bodies.length);
        this.restQ = sk2.bodies.map((b) => {
          const [x, y, z, w] = restQuatOf(b.restTiltRad, b.restYawRad);
          return { x, y, z, w };
        });
        sk2.bodies.forEach((b, i) => {
          this.indexByKey.set(b.key, i);
          this.initX[i] = b.cx;
          this.initY[i] = b.cy;
          this.initZ[i] = b.cz;
          const body = this.world.createRigidBody(
            rapier_default.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz).setRotation(this.restQ[i]).setLinearDamping(this.opt.linearDamping).setAngularDamping(this.opt.angularDamping).setCanSleep(false)
          );
          this.bodies.push(body);
          for (const c of b.colliders) {
            const cd = c.shape === "capsule" ? rapier_default.ColliderDesc.capsule(c.halfHeight, c.radius) : rapier_default.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
            cd.setTranslation(0, c.offsetY, c.offsetZ).setMassProperties(
              c.mass,
              { x: 0, y: c.comY, z: 0 },
              { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ },
              IDENTITY
            ).setFriction(this.opt.bodyFriction).setRestitution(0).setCollisionGroups(GROUPS_SELF);
            const col = this.world.createCollider(cd, body);
            if (c.shape === "cuboid") {
              if (b.key === "shin_l" || b.key === "foot_l") this.soleCol[0] = col;
              else if (b.key === "shin_r" || b.key === "foot_r") this.soleCol[1] = col;
            }
          }
        });
        this.jointBodies = new Int32Array(sk2.joints.length * 2);
        this.createJoints();
        this.jointIeff = new Float64Array(sk2.joints.length);
        const bodyI = new Float64Array(this.bodies.length);
        for (let i = 0; i < this.bodies.length; i++) {
          const I = this.bodies[i].principalInertia();
          bodyI[i] = Math.max(1e-6, Math.max(I.x, Math.max(I.y, I.z)));
        }
        for (let i = 0; i < sk2.joints.length; i++) {
          const ip = bodyI[this.jointBodies[i * 2]];
          const ic = bodyI[this.jointBodies[i * 2 + 1]];
          this.jointIeff[i] = 1 / (1 / ip + 1 / ic);
        }
        this.motorAuthority.fill(1);
        this.groundFactor.fill(1);
        this.ankleGroundFactorUsed.fill(1);
        {
          const footKeys = ["foot_l", "foot_r", "shin_l", "shin_r"];
          const hasFootBelow = /* @__PURE__ */ new Map();
          const walk = (k) => {
            const hit = hasFootBelow.get(k);
            if (hit !== void 0) return hit;
            let r = false;
            for (const jj of sk2.joints) {
              if (jj.parentKey === k) {
                if (walk(jj.childKey)) {
                  r = true;
                  break;
                }
              }
            }
            hasFootBelow.set(k, r);
            return r;
          };
          for (const k of footKeys) hasFootBelow.set(k, true);
          for (let bi = 0; bi < sk2.bodies.length; bi++) {
            const k = sk2.bodies[bi].key;
            if (!footKeys.includes(k)) continue;
            hasFootBelow.set(k, true);
          }
          for (let i = 0; i < sk2.joints.length; i++) {
            const jn = sk2.joints[i];
            if (!walk(jn.childKey)) continue;
            const aj = this.bodies[this.jointBodies[i * 2 + 1]];
            const ap = aj.translation();
            const inSub = /* @__PURE__ */ new Set();
            for (let bi = 0; bi < sk2.bodies.length; bi++) {
              if (sk2.bodies[bi].key === jn.childKey) inSub.add(bi);
            }
            let frontier = [jn.childKey];
            while (frontier.length) {
              const k = frontier.pop();
              for (let bi = 0; bi < sk2.bodies.length; bi++) {
                const bd = sk2.bodies[bi];
                if (inSub.has(bi)) continue;
                if (sk2.joints.some((jj) => jj.parentKey === k && jj.childKey === bd.key)) {
                  inSub.add(bi);
                  frontier.push(bd.key);
                }
              }
            }
            let sum = 0;
            for (let bi = 0; bi < sk2.bodies.length; bi++) {
              if (inSub.has(bi)) continue;
              const t = this.bodies[bi].translation();
              const dx = t.x - ap.x, dy = t.y - ap.y, dz = t.z - ap.z;
              sum += sk2.bodies[bi].mass * (dx * dx + dy * dy + dz * dz);
            }
            const free = this.jointIeff[i];
            const need = Math.max(...jn.maxTorque) * (1 / 120) / JOINT_MAX_SPEED;
            this.groundFactor[i] = Math.max(1, Math.min(
              this.opt.ankleGroundFactor,
              sum / Math.max(1e-9, free),
              need / Math.max(1e-9, free)
            ));
            this.ankleGroundFactorUsed[i] = this.groundFactor[i];
          }
        }
        if (false) {
          const ank = jointIndexByName(sk2, "foot_l");
          const ankR = jointIndexByName(sk2, "foot_r");
          for (const jn of [ank, ankR]) {
            if (jn < 0) continue;
            const footBody = jn === ank ? 0 : 1;
            const aj = this.bodies[this.jointBodies[jn * 2 + 1]];
            const ap = aj.translation();
            let sum = 0;
            for (const b of this.bodies) {
              if (b === aj) continue;
              const t = b.translation();
              const dx = t.x - ap.x, dy = t.y - ap.y, dz = t.z - ap.z;
              sum += b.mass() * (dx * dx + dy * dy + dz * dz);
            }
            const free = this.jointIeff[jn];
            const tauMax = sk2.joints[jn].maxTorque[AXIS_Z] ?? 45;
            const want = tauMax * (1 / 120) / JOINT_MAX_SPEED;
            const need = want / Math.max(1e-9, free);
            const f = Math.max(1, Math.min(this.opt.ankleGroundFactor, sum / Math.max(1e-9, free), need));
            this.groundFactor[jn] = f;
            this.ankleGroundFactorUsed[jn] = f;
          }
        }
        this.refPos = new Float64Array(sk2.joints.length * 3);
        this.refNeg = new Float64Array(sk2.joints.length * 3);
        for (let i = 0; i < sk2.joints.length; i++) {
          for (let k = 0; k < 3; k++) {
            const s = this.opt.posRefScale;
            const span = Math.max(Math.abs(sk2.joints[i].minRad[k]), Math.abs(sk2.joints[i].maxRad[k]));
            this.refPos[i * 3 + k] = s * span;
            this.refNeg[i * 3 + k] = s * span;
          }
        }
      }
      /**
       * 建/重建所有关节。
       * 球关节只有两个锚点参数，没有轴、没有限位 —— 限位和马达全在 driveMotors 里。
       */
      createJoints() {
        this.joints.length = 0;
        this.hipIdx = [
          this.sk.joints.findIndex((j) => j.name === "hip_l"),
          this.sk.joints.findIndex((j) => j.name === "hip_r")
        ];
        this.sk.joints.forEach((j, i) => {
          const pi = this.indexByKey.get(j.parentKey);
          const ci = this.indexByKey.get(j.childKey);
          if (pi === void 0 || ci === void 0) {
            throw new Error(`[ragdoll] \u5173\u8282 ${j.name} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
          }
          this.jointBodies[i * 2] = pi;
          this.jointBodies[i * 2 + 1] = ci;
          const jd = rapier_default.JointData.spherical(
            { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] },
            { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] }
          );
          jd.limitsEnabled = true;
          jd.limits = [j.minRad[0], j.maxRad[0], j.minRad[1], j.maxRad[1], j.minRad[2], j.maxRad[2]];
          this.joints.push(this.world.createImpulseJoint(jd, this.bodies[pi], this.bodies[ci], true));
        });
      }
      get jointCount() {
        return this.joints.length;
      }
      // ------------------------------------------------------------ 读状态
      /** 把刚体本地向量 v 转到世界，写入 out */
      toWorld(b, vx, vy, vz, out) {
        const q = b.rotation();
        quatRotate(q.x, q.y, q.z, q.w, vx, vy, vz, out);
      }
      /** 刚体"上方向"相对世界竖直的夹角（弧度，0 = 完全直立）。摔倒判定/姿态评分用 */
      /**
       * ★ 脚是否着地（**Rapier 真实接触对**，不是几何判据）。
       *   判据：存在接触流形、且法向的竖直分量 |n·y| > 0.5（只认"从上方压下来"的接触）。
       *   自碰撞是关的（GROUPS_SELF 只和地面碰），所以任何接触对就是对地接触。
       *   为什么不用几何：几何判据（鞋底 4 角最低点 ≤ 3cm）有死区，实测脚抬到 9cm
       *   仍被判成着地 ⇒ `lift` 项恒为 0。
       */
      /**
       * ★★★ **真·压力中心（CoP）** —— 直接由接触冲量加权算出（重构方案 §14.5 F1/F2 的验收量）。
       *
       *     CoP = Σ(P_i · λ_i) / Σλ_i        λ_i = 该接触点的法向冲量
       *
       * 为什么要直接读，而不是像以前那样从 ΔCoM 反推：
       *   反推量的是"身体怎么动了"，混着惯量与耦合；直接读压力分布才是**足底发力**本身。
       *   并且它是判定"接触柔度有没有用"的唯一干净指标：
       *     刚性足 ⇒ CoP 被钉在接触面形心附近，踝怎么转都几乎不动；
       *     柔性足 ⇒ CoP 随踝力矩**连续移动**，且可能超过 `τ/(mg)` 的刚性上限。
       *
       * @param side 0=左 1=右
       * @param out  写入 [copX, copY, copZ, Σλ]（世界系；无接触时 Σλ=0）
       */
      readCoP(side, out) {
        const col = this.soleCol[side];
        out[0] = out[1] = out[2] = out[3] = 0;
        if (!col) return;
        let sx = 0, sy = 0, sz = 0, sl = 0;
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (mf) => {
            const n = mf.numSolverContacts();
            for (let i = 0; i < n; i++) {
              const ny = mf.normal().y;
              if (Math.abs(ny) < 0.5) continue;
              const p = mf.solverContactPoint(i);
              const l = Math.abs(mf.contactImpulse(i));
              if (!(l > 0)) continue;
              sx += p.x * l;
              sy += p.y * l;
              sz += p.z * l;
              sl += l;
            }
          });
        });
        if (sl > 0) {
          out[0] = sx / sl;
          out[1] = sy / sl;
          out[2] = sz / sl;
        }
        out[3] = sl;
      }
      /** 只取竖向分量是否受力（比 footGrounded 更严：必须有正冲量） */
      footLoaded(side) {
        this.readCoP(side, this.copTmp);
        return this.copTmp[3] > 0;
      }
      ankleJoint;
      ankleJointR;
      footAuthUsed;
      /** 实际采用的接地惯量放大倍数（诊断：扫参时看它） */
      ankleGroundFactorUsed;
      /**
       * 该关节的**子侧是否有脚承重** ⇒ 是则用被地面约束放大的等效惯量。
       * 只需查踝（唯一直接连脚的身体），向上传递由调用方按关节链判断。
       */
      footLoadedFlag(joint) {
        this.readCoP(0, this.copTmp);
        const gl = this.copTmp[3] > 0;
        this.readCoP(1, this.copTmp);
        const gr = this.copTmp[3] > 0;
        this.footLoadedCache = { l: gl, r: gr };
        return gl || gr;
      }
      /** 两侧脚的承重缓存（由 `footLoadedFlag` 刷新） */
      footLoadedCache = { l: false, r: false };
      footGrounded(side) {
        const col = this.soleCol[side];
        if (!col) return false;
        let hit = false;
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (mf) => {
            if (mf.numContacts() === 0) return;
            const ny = mf.normal().y;
            if (ny > 0.5 || ny < -0.5) hit = true;
          });
        });
        return hit;
      }
      /**
       * ★★ 每只脚的**竖向载荷份额**（`[左, 右]`，和为 1；两只都没受力时给 [0.5, 0.5]）。
       *
       * ★ 为什么用"载荷"而不是"几何接触"来做重心转移/换支撑脚的判据：
       *   ① 几何接触（`contactDist`）要 0.5 cm 以内才算出，抬 1~2 cm 的小步根本测不到；
       *   ② Rapier 窄相还保留**预测性接触**（形状没碰但进了预测距离），实测脚离地 9 cm
       *      仍会报接触（这是踩过的坑，见 footGrounded 的注释）。
       *   而"这只脚承担了 70% 的体重"**才是支撑腿的定义**，也是 Raibert/捕获点那套
       *   真正在控的量（把重心挪到支撑脚上）。
       *
       * 取法与 `tools/probe-coact` 一致：Σ|n_y·冲量| / dt，取绝对值 ⇒ 与法向符号约定无关。
       */
      footLoadFrac(dt) {
        const one = (side) => {
          const col = this.soleCol[side];
          if (!col) return 0;
          let f = 0;
          this.world.contactPairsWith(col, (other) => {
            this.world.contactPair(col, other, (mf) => {
              if (mf.numContacts() === 0) return;
              for (let k = 0; k < mf.numContacts(); k++) f += Math.abs(mf.contactImpulse(k)) / dt;
            });
          });
          return f;
        };
        const fl = one(0), fr = one(1);
        const sum = fl + fr;
        return sum > 1e-6 ? [fl / sum, fr / sum] : [0.5, 0.5];
      }
      /**
       * ★★ 支撑脚的**法向力 / 切向力 / 摩擦利用率**（诊断"体重有没有真的压上去、脚有没有打滑"）。
       *   用户 2026-10-02："我认为需要保证脚底真能抓地或者身体的体重真的压在脚上了"。
       *   返回 `[法向力N, 切向力N, μ·法向力N]`：
       *     · 法向力 ≈ 0 ⇒ 体重**没压在脚上**（脚在飘）
       *     · 切向力 ≥ μ·法向力 ⇒ 已在**打滑**边界
       *   Rapier 的 `TempContactManifold` 只暴露法向冲量，切向冲量要靠切点速度估计，
       *   这里用"接触点相对切向速度 × 法向冲量"做一阶估计。
       */
      footGrip(side, dt) {
        const col = this.soleCol[side];
        if (!col) return [0, 0, 0];
        let fn = 0;
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (mf) => {
            if (mf.numContacts() === 0) return;
            for (let k = 0; k < mf.numContacts(); k++) fn += Math.abs(mf.contactImpulse(k)) / dt;
          });
        });
        const body = this.bodies[this.indexByKey.get(side === 0 ? "foot_l" : "foot_r") ?? 0];
        const v = body.linvel();
        const slip = Math.hypot(v.x, v.z);
        return [fn, fn * slip, fn * slip * 0.35];
      }
      /**
       * ★★ 交替支撑脚（"一次抬一条"）的**事件**判据，返回 true 表示"这一拍发生了换脚"。
       *
       * ★★ 为什么要做成**事件**而不是"当前是否单脚支撑"（用户 2026-10-01：
       *   "抬一次脚就摔倒了，什么也学不到"）：
       *   实测几何上**长时间单脚支撑是不可能的** —— 两脚在 z=±0.164 m，CoM 在 z≈0.007，
       *   抬掉一只脚后 CoM 离另一只脚 0.171 m，而单脚（含外八 25° 投影）只有 0.139 m
       *   侧向半宽 ⇒ **差 1.23×**。站距收到 0.181 m 才有 1.43×，但那会让脚骨比画出来的靴子
       *   内缩 7 cm（用户早就投诉过"脚部和纹理不太匹配"），而且真正的解法是踝关节内外翻
       *   —— 也就是 `ankleEnabled`（代码就绪、默认关，见架构设计 §12.6）。
       *   但**短暂的交替是可行的**（顶翻的时间常数 ~1/ω ≈ 0.2 s，0.1 s 的抬脚不会倒，
       *   种子步态 1.25 m 就是这么走的）⇒ "一次抬一条"应该按**换支撑脚的事件**计分。
       *
       * @param stanceNow 0=双脚离地 1=左脚支撑 2=右脚支撑
       */
      lastStance = 0;
      stanceAge = 0;
      altEvent(stanceNow, dt) {
        this.stanceAge += dt;
        const prev = this.lastStance;
        this.lastStance = stanceNow;
        const switched = prev === 1 && stanceNow === 2 || prev === 2 && stanceNow === 1;
        if (switched && this.stanceAge > 0.15) return true;
        if (stanceNow === 0) this.stanceAge = 0;
        return false;
      }
      resetAlt() {
        this.lastStance = 0;
        this.stanceAge = 0;
      }
      /**
       * ★★ 摔倒（crash）判据：**任何非脚部刚体碰到地面**。
       *   这是 Rudin 2022 的原话做法（"contacts with the base are considered crashes
       *   and lead to resets"）。之前只用"躯干高度/倾角"判摔，于是**往前塌**不算摔：
       *   实测零输出基因组 0.5 s 内塌 41 cm、躯干高度还有 70%、倾角几乎不变 ⇒
       *   回合不结束，它一路滑出 0.65~1.25 m 还能拿速度跟踪分。
       */
      /**
        * ★★ 最近一次 `bodyHitGround()` 命中的**刚体名**（空 = 没命中）。
        *   用于调试："摔倒到底是哪个部位碰地触发的" —— 手/肘在正常低姿态下就接近地面，
        *   如果它们也算 crash，就会误伤，把本可以继续的重心转移判成摔倒。
        */
      lastHitKey = "";
      /** 该刚体所有碰撞体的最低点世界 y（m）；没碰撞体返回 +Infinity */
      lowestY(i) {
        const b = this.bodies[i];
        let lo = Infinity;
        for (let ci = 0; ci < b.numColliders(); ci++) {
          const c = b.collider(ci);
          const a = c.aabb?.();
          if (a && a.min.y < lo) lo = a.min.y;
        }
        return lo;
      }
      /**
        * ★★ 不算 crash 的刚体（2026-10-02，用户："摔倒被判定太严了"）。
        *   实测证据：关掉躯干高度判据后，crash 抓到的是 **hand_l** ——躯干蹲到 0.796m、
        *   头 0.925m、倾角 0°，这是"弯腰用手撑一下"的正常姿态，不是摔倒。
        *   ⇒ 手/前臂不参与 crash 判据；躯干、头、大腿、小腿仍参与（那才是真摔）。
        */
      static NOT_CRASH = /* @__PURE__ */ new Set(["shin_l", "shin_r", "foot_l", "foot_r", "arm_l", "arm_r", "hand_l", "hand_r"]);
      bodyHitGround() {
        this.lastHitKey = "";
        for (let i = 0; i < this.bodies.length; i++) {
          const bd = this.sk.bodies[i];
          if (_Ragdoll.NOT_CRASH.has(bd.key)) continue;
          const b = this.bodies[i];
          for (let ci = 0; ci < b.numColliders(); ci++) {
            const col = b.collider(ci);
            let hit = false;
            this.world.contactPairsWith(col, (other) => {
              this.world.contactPair(col, other, (mf) => {
                if (mf.numContacts() === 0) return;
                const ny = mf.normal().y;
                if (ny > 0.5 || ny < -0.5) hit = true;
              });
            });
            if (hit) {
              this.lastHitKey = bd.key;
              return true;
            }
          }
        }
        return false;
      }
      tiltOf(body) {
        this.toWorld(body, 0, 1, 0, this.dirTmp);
        const y = this.dirTmp[1] > 1 ? 1 : this.dirTmp[1] < -1 ? -1 : this.dirTmp[1];
        return Math.acos(y);
      }
      /** 刚体"前方向"在世界 XZ 平面里的方位角（弧度；绕 +Y 转，0 = 正对 +X） */
      headingOf(body) {
        this.toWorld(body, 1, 0, 0, this.dirTmp);
        return Math.atan2(-this.dirTmp[2], this.dirTmp[0]);
      }
      /**
       * 关节 i 的**三轴关节角**（父体本地的旋转向量，弧度）写入 out[0..2]。
       * |out| ≤ π；分量含义 = 绕父体本地 X/Y/Z 各转了多少。
       * ★ 这是 3D 关节的姿态真源：软限位、网络输入、探针全走它。
       */
      jointRot(i, out = this.rv) {
        const pi = this.jointBodies[i * 2];
        const ci = this.jointBodies[i * 2 + 1];
        const qp = this.bodies[pi].rotation();
        const qc = this.bodies[ci].rotation();
        calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, this.qRel, out);
        const rr = this.sk.joints[i].restRad;
        out[0] -= rr[0];
        out[1] -= rr[1];
        out[2] -= rr[2];
      }
      /** 关节 i 的**三轴相对角速度**（父体本地，rad/s）写入 out[0..2] */
      jointRelVel(i, out = this.relL) {
        const p = this.bodies[this.jointBodies[i * 2]];
        const c = this.bodies[this.jointBodies[i * 2 + 1]];
        const wp = p.angvel();
        const wc = c.angvel();
        const qp = p.rotation();
        calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, out);
      }
      /** 兼容标量读数：关节 i 的屈伸角（绕本地 Z 的分量，弧度） */
      jointAngle(i) {
        const buf = this.rvTmp;
        this.jointRot(i, buf);
        return buf[2];
      }
      /**
       * ★ 关节锚点的**世界坐标**（父刚体变换 × parentLocal）。
       *   teacher 的 IK 需要真实髋位置 —— 之前用 `com.y − HIP_DY` 推算，
       *   虚拟髋(0.744m) 和真实髋刚体(0.849m) 差了 10cm ⇒ IK 按错的骨盆高度算腿姿，
       *   踝前摆时必然扫地（用户："盆骨抬得不够高，导致踝部向前会触地"）。
       */
      jointWorld(i, out) {
        const j = this.sk.joints[i];
        if (!j) {
          out[0] = out[1] = out[2] = 0;
          return;
        }
        const p = this.bodies[this.jointBodies[i * 2]];
        const t = p.translation(), r = p.rotation();
        const lx = j.parentLocal[0], ly = j.parentLocal[1], lz = j.parentLocal[2];
        const ix = r.w * lx + r.y * lz - r.z * ly;
        const iy = r.w * ly + r.z * lx - r.x * lz;
        const iz = r.w * lz + r.x * ly - r.y * lx;
        const iw = -r.x * lx - r.y * ly - r.z * lz;
        out[0] = t.x + ix * r.w + iw * -r.x + iy * -r.z - iz * -r.y;
        out[1] = t.y + iy * r.w + iw * -r.y + iz * -r.x - ix * -r.z;
        out[2] = t.z + iz * r.w + iw * -r.z + ix * -r.y - iy * -r.x;
      }
      /** 兼容标量读数：关节 i 绕本地 Z 的相对角速度（rad/s） */
      jointSpeed(i) {
        const buf = this.rvTmp;
        this.jointRelVel(i, buf);
        return buf[2];
      }
      rvTmp = new Float64Array(3);
      /**
       * 写马达命令：targets 长度 = 关节数 × 3，每个 ∈ [-1,1]，**表示该轴的目标关节角**
       * （占该侧机械量程的比例的 posRefScale 倍，见 RagdollOptions.posRefScale）。
       *
       * ★ 语义已从"目标角速度"改成"目标角" —— 这是本项目的头号结构性修正：
       *   速度目标没有静态刚度（静载荷下必然蠕变），而且不可被网络用来"维持一个姿态"。
       *   见 RagdollOptions.kP 的长注释。
       *
       * 只存不施加 —— 真正的力矩在 driveMotors() 里按物理步施加。
       */
      setMotorTargets(targets) {
        for (let i = 0; i < this.motorTarget.length; i++) {
          const t = targets[i];
          this.motorTarget[i] = t < -1 ? -1 : t > 1 ? 1 : t;
        }
      }
      /**
       * ★ 自实现的**位置环 PD** 关节马达：每物理步调用一次，dt = 物理步长。
       *
       *     θ_ref  = cmd ×（cmd ≥ 0 ? posRefScale·hi : posRefScale·(−lo)）   // 网络给的目标角
       *     err    = kP·(θ_ref − θ) − kD·ω_rel                              // 等效目标角速度
       *     τ      = clamp(err · τmax / JOINT_MAX_SPEED, ±τmax)
       *
       * 增益取 τmax/JOINT_MAX_SPEED ⇒ **err 跑满 JOINT_MAX_SPEED 时正好输出 τmax**，物理含义清晰。
       * 然后把"本地轴上的力矩冲量"用父体姿态搬到世界，对父/子各施加一对等大反向的冲量。
       *
       * ★★ 为什么是位置环而不是"角速度目标"（这是本项目最重的一处结构性修正）：
       *   速度目标下，`cmd = 0` 的含义是"把角速度刹到 0"（`err = −ω_rel ≠ 0`）⇒ 关节一直在**制动**，
       *   但它**没有静态刚度**：重力压着膝盖，只要膝盖不转，误差就恰好等于 0、力矩也就没了。
       *   ⇒ 静载荷下必然**蠕变**（实测没位置项时躯干 1 s 内从 0.888 掉到 0.149 m）。
       *   位置环天然有静态刚度：θ ≠ θ_ref 就一直有力，这才是"站着不动"能成立的前提。
       *   ★ 且 `θ_ref = 0` 时 `err = −kP·θ − kD·ω_rel`，与历史公式 `target = −k·θ; err = target − ω_rel`
       *     **逐项一致** ⇒ 这是严格泛化，零输出的行为一字没变，但网络拿到了位置通道。
       *
       * ★★ 两处必须保留的护栏：
       *   1) 稳定性上限 |imp| ≤ α·|err|·Ieff（见构造里 jointIeff 的注释）——
       *      只限力矩不限加速度的话，轻肢体（前臂 I≈0.03）会被打出每步 28 rad/s 的相对转速，
       *      显式积分的比例控制直接发散（probe-reset 的 284 m/s）。
       *   2) 位置感知软限位 —— 替代 Rapier 的硬限位（球关节压根没有）。
       *      越界时把该轴的目标速度强制指向回程，越界越多回程越快，最多打满 JOINT_MAX_SPEED。
       *      这样马达再怎么被网络驱动都不可能把关节推出限位之外，
       *      也就不存在"推出去 → 限位猛烈纠正 → 甩飞"的爆炸路径
       *      （probe-spike：Rapier 硬限位下 neck 被推到 −162°、限位 [−35°,45°]，
       *        纠正时相对角速度顶到 68.9 rad/s → 头甩飞 → 整条链炸）。
       *      ★ 它只在**越界之后**介入，越界时直接接管该轴的目标速度（不再走位置环）
       *        —— 回程是"保命动作"，不该被网络的位置命令拖住。
       */
      driveMotors(dt) {
        const scale = this.opt.torqueScale;
        this.lastDt = dt;
        const kP = this.opt.kP;
        const kD = this.opt.kD;
        const qRel = this.qRel;
        const rv = this.rv;
        const relL = this.relL;
        const jg = this.opt.jointGain ?? {};
        for (let i = 0; i < this.joints.length; i++) {
          const j = this.sk.joints[i];
          const pi = this.jointBodies[i * 2];
          const ci = this.jointBodies[i * 2 + 1];
          const p = this.bodies[pi];
          const c = this.bodies[ci];
          const qp = p.rotation();
          const qc = c.rotation();
          const wp = p.angvel();
          const wc = c.angvel();
          calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, qRel, rv);
          const rr = j.restRad;
          rv[0] -= rr[0];
          rv[1] -= rr[1];
          rv[2] -= rr[2];
          calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, relL);
          const gf = this.footLoadedFlag(i) && this.groundFactor[i] > 1 ? this.groundFactor[i] : 1;
          const Ieff = this.jointIeff[i] * gf;
          for (let k = 0; k < 3; k++) {
            this.motorImpulse[i * 3 + k] = 0;
            this.motorDemand[i * 3 + k] = 0;
            const lo = j.minRad[k];
            const hi = j.maxRad[k];
            const a = rv[k];
            const idx = i * 3 + k;
            let alpha = this.opt.motorAlpha;
            let err;
            const ramp = Math.min(LIMIT_SOFT_ZONE, hi - lo);
            if (a > hi) {
              err = -JOINT_MAX_SPEED * Math.min(1, (a - hi) / ramp) - relL[k];
              alpha = MOTOR_ALPHA_RECOVER;
            } else if (a < lo) {
              err = JOINT_MAX_SPEED * Math.min(1, (lo - a) / ramp) - relL[k];
              alpha = MOTOR_ALPHA_RECOVER;
            } else {
              const cmd = this.motorTarget[idx];
              const thRef = cmd >= 0 ? cmd * this.refPos[idx] : cmd * this.refNeg[idx];
              const ov = jg[j.name];
              err = (ov ? ov.kP : kP) * (thRef - a) - (ov ? ov.kD : kD) * relL[k];
            }
            if (err === 0) continue;
            const tauMax = j.maxTorque[k] * scale;
            let tau = err * (tauMax / JOINT_MAX_SPEED);
            if (tau > tauMax) tau = tauMax;
            else if (tau < -tauMax) tau = -tauMax;
            this.motorDemand[idx] = tau;
            let imp = tau * dt;
            const impStable = alpha * Math.abs(err) * Ieff;
            const impWant = imp;
            if (imp > impStable) imp = impStable;
            else if (imp < -impStable) imp = -impStable;
            if (imp === 0) continue;
            this.motorAuthority[idx] = Math.min(1, Math.abs(imp) / Math.max(1e-12, Math.abs(impWant)));
            this.footAuthUsed[idx] = gf;
            if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
            else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
            else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
            const iv = this.iv;
            iv.x = this.axisW[0] * imp;
            iv.y = this.axisW[1] * imp;
            iv.z = this.axisW[2] * imp;
            this.motorImpulse[idx] = imp;
            c.applyTorqueImpulse(iv, true);
            iv.x = -iv.x;
            iv.y = -iv.y;
            iv.z = -iv.z;
            p.applyTorqueImpulse(iv, true);
          }
          for (let k = 0; k < 3; k++) {
            const lo2 = j.minRad[k], hi2 = j.maxRad[k];
            if (hi2 - lo2 >= Math.PI * 1.99) continue;
            const a2 = this.jointRotAxis(i, k);
            const out = a2 > hi2 ? 1 : a2 < lo2 ? -1 : 0;
            if (out === 0) continue;
            let w;
            if (k === AXIS_X) w = c.angvel().x - p.angvel().x;
            else if (k === AXIS_Y) w = c.angvel().y - p.angvel().y;
            else w = c.angvel().z - p.angvel().z;
            if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
            else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
            else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
            const av = c.angvel(), ap = p.angvel();
            const wRel = (av.x - ap.x) * this.axisW[0] + (av.y - ap.y) * this.axisW[1] + (av.z - ap.z) * this.axisW[2];
            if (out > 0 ? wRel <= 0 : wRel >= 0) continue;
            const J = -wRel * this.jointIeff[i];
            const jv = this.iv;
            jv.x = this.axisW[0] * J;
            jv.y = this.axisW[1] * J;
            jv.z = this.axisW[2] * J;
            c.applyTorqueImpulse(jv, true);
            jv.x = -jv.x;
            jv.y = -jv.y;
            jv.z = -jv.z;
            p.applyTorqueImpulse(jv, true);
            this.limitHits++;
          }
        }
      }
      /**
       * ★★★ **足底虚拟支撑点**（Virtual Support Point）—— 让踝获得 CoP 权限。
       *
       *   ── 为什么需要（2026-10-02 实测确立）───────────────────────────
       *     物理账户：体重 687 N、CoP 杠杆 75 mm ⇒ 撑住不动需要 **52 N·m** 踝力矩；
       *     人类跖屈肌 MVC ~120~140 N·m，我们的踝只有 45 N·m。
       *     但把踝从 45 抬到 120/160/220 N·m，存活反而**变差**（1.77s → 0.65s）——
       *     说明**不是力矩不够**，而是**力矩传不到地面**。
       *     原因：**足底是刚性平底盒**，压在平地上时踝一转只是把盒面压实，
       *     压力中心被几何锁在接触面形心 ⇒ 踝**无法移动 CoP**
       *     （这一现象已被四种独立测法确认：kCop×33 / ankleTorque×9 / VIP刚度比×3.7
       *      / 踝限幅收紧，全都不改变 CoM 与存活）。
       *     ⇒ 踝策略（= CoP 策略，文献里的**主力**）在本 rig 里结构性失效，
       *       矢状面只能由髋代偿，而髋效率只有跖屈肌的 **1/4**
       *       （Neptune & Perry, Front Neurol 2019, 10:999）⇒ 必然饱和 ⇒ 必然倒。
       *
       *   ── 物理依据 ──────────────────────────────────────────────────
       *     Morasso et al., Front Comput Neurosci 2022, 15:956932：
       *       踝策略 = "**CoP strategy**" —— "the role of the active intermittent control
       *       is to shift the position of the **CoP** on the support base"。
       *     Michaels & Ting, Sci Rep 2025, 15:97637：
       *       "The biomechanical constraint was defined as the **CoP range limitation to
       *       the metatarsal joint**" ⇒ CoP 能在**脚掌内**前后移动，出界则踝力矩饱和。
       *     Wright et al.（同上引述）：脚**不是刚性基座，而是有柔性的**，
       *       "sensitive to minute deformations" ⇒ 压力中心可移动有物理来源。
       *
       *   ── 本实现的做法（不是加肌肉）──────────────────────────────────
       *     在足底维护一个**沿足长轴滑动的虚拟接触点** `copOffset`：
       *       · `copOffset ∈ [−halfLen, +halfLen]`（跖骨头 ↔ 足跟，Sci Rep 2025 的行程）
       *       · 每步在**真实接触点**处施加一个支撑力，而不是让刚体盒自己决定压力中心
       *       · 位置由踝指令（VIP 的 `ankleSag`）驱动
       *     等价于"足底有微小柔性"，让踝力矩真正产生 GRF 力矩 ⇒ CoP 可控。
       *
       *   ⚠ 已知局限：`copOffset` 是**运动学**的（直接给定位置），不含足底软组织的
       *     本构关系；要更真实需要把足底建成若干带弹簧的子段。
       */
      copOffset = new Float64Array(2);
      // [左, 右]，沿足长轴，单位 m
      /** 设置某只脚的 CoP 位置（相对踝/足中心，沿足长轴；超出 ±halfLen 会被钳住） */
      setCoP(side, offset, halfLen) {
        this.copOffset[side] = Math.max(-halfLen, Math.min(halfLen, offset));
      }
      getCoP(side) {
        return this.copOffset[side];
      }
      /**
       * ★★★ **逐轴物理限位**（冲量层）—— **必须在 `world.step()` 之后调用**。
       *
       * 为什么自己做（Rapier 0.14 的限制，已查源码确认）：
       *   · `JointData.spherical()` 的球铰不启用限位；
       *   · JS 封装只读 `limits[0]`/`limits[1]` —— **单一 (min,max) 对**
       *     （`dynamics/impulse_joint.js:399-400`），**没有逐轴限位**；
       *   · `JointData.generic` 只有 1 自由度，替代不了 3 自由度的球铰。
       *
       * 机制：越界且还在往外走 ⇒ 施加 `J = −ω_rel·I_eff` 的角冲量，把该轴相对角速度
       * **归零**（恢复系数 e=0 的限位挡块）。往回走不拦，否则锁死回程。
       *
       * ★★ 为什么必须放在步**后**（2026-10-02，两次踩坑）：
       *   ① 放步前（= `driveMotors` 里，而它在 `world.step()` 之前）⇒ 求解器在步内
       *      产生的接触响应完全看不见 ⇒ 踝实测跑到 **+96.5°**（限位 +18°，88% 帧越界）。
       *   ② 惯量不能用 `jointIeff`（它取的是**主惯量的最小值**，`Math.min(I.x,I.y,I.z)`，
       *      对细长的脚掌极小）⇒ 冲量严重不足。这里改用**两体沿该轴的惯量之和**，
       *      由 `principalInertia()` 在该轴上的分量估一个保守下界。
       */
      enforceLimits() {
        for (let i = 0; i < this.sk.joints.length; i++) {
          const j = this.sk.joints[i];
          const pi = this.jointBodies[i * 2], ci = this.jointBodies[i * 2 + 1];
          const p = this.bodies[pi], c = this.bodies[ci];
          const qp = p.rotation();
          for (let k = 0; k < 3; k++) {
            const lo2 = j.minRad[k], hi2 = j.maxRad[k];
            if (hi2 - lo2 >= Math.PI * 1.99) continue;
            const a2 = this.jointRotAxis(i, k);
            const out = a2 > hi2 ? 1 : a2 < lo2 ? -1 : 0;
            if (out === 0) continue;
            if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
            else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
            else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
            const av = c.angvel(), ap = p.angvel();
            const wRel = (av.x - ap.x) * this.axisW[0] + (av.y - ap.y) * this.axisW[1] + (av.z - ap.z) * this.axisW[2];
            const Ip = p.principalInertia(), Ic = c.principalInertia();
            const Iax = Math.max(Ip.x, Ip.y, Ip.z) + Math.max(Ic.x, Ic.y, Ic.z);
            const jv = this.iv;
            if (out > 0 ? wRel > 0 : wRel < 0) {
              const J = -wRel * Iax;
              jv.x = this.axisW[0] * J;
              jv.y = this.axisW[1] * J;
              jv.z = this.axisW[2] * J;
              c.applyTorqueImpulse(jv, true);
              jv.x = -jv.x;
              jv.y = -jv.y;
              jv.z = -jv.z;
              p.applyTorqueImpulse(jv, true);
              this.limitHits++;
            }
          }
        }
      }
      /**
       * ★★★ **在虚拟支撑点处施加支撑力**（力偶）。
       *
       * 让踝获得 CoP 权限的唯一途径。此前踝指令对动力学**零效力**
       * （`kCop`×33 / `ankleTorque`×9 / VIP 刚度比×3.7 三种测法结果**逐位相同**），
       * 根因是**刚性平底盒**把压力中心锁死在接触面形心 —— 踝一转只是压实盒面，CoP 移不动。
       * 改为显式把支撑力作用在足底沿长轴偏移 `copOffset` 的点上，闭合
       * 「踝倾角 → 力臂 → GRF 力矩 → CoM 加速度」这条链（Morasso 2022 的 CoP 策略）。
       *
       * ⚠ 必须是**力偶**（偏移点 +F、脚心 −F）：净力为 0、只有力矩 F·copOffset。
       *   第一版写成"额外的力"，体重被算两遍，存活 1.77s → 0.40s。
       * ⚠ 默认关闭（`supportPointOn = false`）：用户反馈"支撑腿打滑的感觉" ——
       *   它绕过接触与摩擦，物理上不成立。纯物理路径（靠踝力矩撬脚）才不打滑。
       * ⚠ 已知局限：`copOffset` 是**运动学**的（直接给定位置），不含足底软组织的本构关系；
       *   要更真实需要把足底建成若干带弹簧的子段。
       */
      applySupportPoint(dt) {
        const [fl, fr] = this.footLoadFrac(dt);
        let mSum = 0;
        for (const b of this.bodies) mSum += b.mass();
        for (const side of [0, 1]) {
          const frac = side === 0 ? fl : fr;
          if (frac <= 0.01) continue;
          const foot = this.bodies[this.indexByKey.get(side === 0 ? "foot_l" : "foot_r") ?? 0];
          const F = mSum * 9.81 * frac;
          const q = foot.rotation();
          quatRotate(q.x, q.y, q.z, q.w, 1, 0, 0, this.axTmp);
          const ax = this.axTmp;
          const p = foot.translation();
          this.pcTmp.x = p.x;
          this.pcTmp.y = p.y;
          this.pcTmp.z = p.z;
          this.ptTmp.x = p.x + ax[0] * this.copOffset[side];
          this.ptTmp.y = p.y + ax[1] * this.copOffset[side];
          this.ptTmp.z = p.z + ax[2] * this.copOffset[side];
          this.ivUp.x = 0;
          this.ivUp.y = F * dt;
          this.ivUp.z = 0;
          foot.applyImpulseAtPoint(this.ivUp, this.ptTmp, true);
          this.ivUp.x = 0;
          this.ivUp.y = -F * dt;
          this.ivUp.z = 0;
          foot.applyImpulseAtPoint(this.ivUp, this.pcTmp, true);
        }
      }
      /** 该关节第 k 轴的当前角度（rad）—— 限位判定用 */
      jointRotAxis(i, k) {
        this.jointRot(i, this.rv);
        return this.rv[k];
      }
      /** 诊断用：读出某轴当前的 θ_ref（弧度）。探针要核对"命令 → 目标角"的映射是否对 */
      refAngleOf(joint, axis) {
        const idx = joint * 3 + axis;
        const cmd = this.motorTarget[idx];
        return cmd >= 0 ? cmd * this.refPos[idx] : cmd * this.refNeg[idx];
      }
      // ------------------------------------------------------------ 便利读数
      /**
       * ★ 身体参考点 = **上躯干（胸腔）**，不是树根。
       *
       * 为什么：脊柱分段后（见 SkeletonConfig.spineSegments）树根变成了骨盆，
       * 而"站得直不直 / 现在多高 / 朝哪转"这些量真正的载体是**上躯干**：
       *   · 平衡反馈用的角速度：胸的角速度才是"我在倒"的信号（骨盆更迟钝）
       *   · 直立惩罚 ∫(cos tilt − 1)：必须量胸的倾角，否则弯腰驼背不扣分
       *   · 摔倒判定的高度：骨盆会深蹲（0.83 → 0.5 是正常下蹲），胸塌到地面才是摔
       * 分段前（K=1）它本身就是 'torso'，行为与历史完全一致。
       */
      torso() {
        return this.bodies[this.indexByKey.get(this.torsoKey) ?? 0];
      }
      /** 树根 = 骨盆（脊柱最下一段，key 恒为 'torso'）。行走位移的基准点 */
      root() {
        return this.bodies[this.indexByKey.get("torso") ?? 0];
      }
      head() {
        return this.bodies[this.indexByKey.get("head") ?? 0];
      }
      shin(side) {
        return this.bodies[this.indexByKey.get(side === "l" ? "shin_l" : "shin_r") ?? 0];
      }
      bodyByKey(key) {
        return this.bodies[this.indexByKey.get(key) ?? 0];
      }
      /**
       * 脚掌某点的世界坐标写入 out[0..2]。
       * ★ 3D 之后不能再写 `body.y − length/2`：刚体会转，最低点必须按姿态算。
       *   脚掌 collider 的本地最低点 = (0, offsetY − hy, 0)。
       */
      footPoint(side, out) {
        const footKey = side === "l" ? "foot_l" : "foot_r";
        const useFoot = this.indexByKey.has(footKey);
        const key = useFoot ? footKey : side === "l" ? "shin_l" : "shin_r";
        const idx = this.indexByKey.get(key) ?? 0;
        const b = this.bodies[idx];
        const sole = this.sk.bodies[idx].colliders.find((c) => c.shape === "cuboid");
        const ly = sole ? sole.offsetY - sole.hy : -this.sk.bodies[idx].length / 2;
        const t = b.translation();
        this.toWorld(b, 0, ly, 0, out);
        out[0] += t.x;
        out[1] += t.y;
        out[2] += t.z;
      }
      /**
       * ★ 髋关节锚点的世界位置（IK 的固定端）。
       *   为什么必须有：teacher 的动作是二连杆 IK，函数的自变量就是"髋→脚"这个向量
       *   （dx, dy, d）。网络之前**看不见自己的腿长** ⇒ 得用 tanh 去硬拟合 acos/atan2，
       *   行为克隆的 MSE 卡在 0.17 上下、克隆出来的网络不会走（实测位移 −0.832 m、0 步）。
       *   把 dx/dy/d 直接喂进去之后，IK 退化成"d 的一维平滑函数"，浅层网就能拟合。
       */
      hipPoint(side, out) {
        const i = this.hipIdx[side === "l" ? 0 : 1];
        const j = this.sk.joints[i];
        const b = this.bodies[this.indexByKey.get(j.parentKey) ?? 0];
        const t = b.translation();
        this.toWorld(b, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], out);
        out[0] += t.x;
        out[1] += t.y;
        out[2] += t.z;
      }
      hipIdx = [-1, -1];
      footTmp = new Float64Array(3);
      /** 脚掌最低点的世界 y（接地代理量，比接触查询便宜） */
      soleY(side) {
        this.footPoint(side, this.footTmp);
        return this.footTmp[1];
      }
      /**
       * ★ 脚掌最低点的世界 **x / z**（观测用）。
       *   为什么必须有：策略要"把支撑脚撑在某个世界位置上"，就必须**看得见脚在哪**。
       *   之前观测里只有脚底**高度**和捕获点 ξ，没有脚的 x/z ⇒ 线性策略没法表达
       *   "脚往捕获点落"这条 Raibert 规则，只能两条腿一起蹦（实测脚最高 0.10 m、
       *   换脚数 0 —— 那是**跳**不是**步**）。加上 x/z 之后，落脚规则可以写成线性的：
       *   `hip = k·(ξ_x − sole_x)`。
       */
      soleXZ(side, out = this.footTmp) {
        this.footPoint(side, out);
        return out[1];
      }
      // ------------------------------------------------------------ 重置
      /**
       * 回到初始位姿，清零速度（每个个体开跑前调用）。
       * ★ 若 purgeJointCache：连关节一起删掉重建 —— 清掉解算器的暖启动冲量缓存。
       *   不这么做的话，同一份基因组在同一个 Sim 上重放会从第 1 步就分叉（见 RagdollOptions）。
       */
      reset(offsetX = 0) {
        this.motorTarget.fill(0);
        if (this.opt.purgeJointCache) {
          for (const j of this.joints) this.world.removeImpulseJoint(j, true);
        }
        for (let i = 0; i < this.bodies.length; i++) {
          const b = this.bodies[i];
          b.setTranslation({ x: this.initX[i] + offsetX, y: this.initY[i], z: this.initZ[i] }, true);
          b.setRotation(this.restQ[i], true);
          b.setLinvel(ZERO, true);
          b.setAngvel(ZERO, true);
        }
        if (this.opt.purgeJointCache) this.createJoints();
      }
    };
  }
});

// src/core/brain.ts
var brain_exports = {};
__export(brain_exports, {
  BRAIN_SHAPE: () => BRAIN_SHAPE,
  HIDDEN_UNITS: () => HIDDEN_UNITS,
  INPUT_COUNT: () => INPUT_COUNT,
  INPUT_LAYOUT: () => INPUT_LAYOUT,
  OUTPUT_PER_JOINT: () => OUTPUT_PER_JOINT,
  brainForward: () => brainForward,
  brainLayout: () => brainLayout,
  brainParamCount: () => brainParamCount,
  inputCount: () => inputCount,
  inputLayout: () => inputLayout,
  shapeForJoints: () => shapeForJoints
});
function shapeForJoints(jointCount) {
  return { inputs: 36 + 6 * jointCount, hidden: HIDDEN_UNITS, outputs: 3 * jointCount };
}
function inputCount(jointCount) {
  return 36 + 6 * jointCount;
}
function inputLayout(jointCount) {
  const out = [
    "clock.sin",
    "clock.cos",
    // 0,1
    "chest.quat.x",
    "chest.quat.y",
    "chest.quat.z",
    "chest.quat.w",
    // 2..5
    "chest.vx",
    "chest.vy",
    "chest.vz",
    // 6..8
    "chest.wx",
    "chest.wy",
    "chest.wz",
    // 9..11
    "chest.height",
    // 12
    "chest.lateralZ",
    // 13
    "com.dx",
    "com.dz",
    // 14,15 CoM 相对支撑域中心（m）
    "com.vx",
    "com.vz",
    // 16,17 CoM 水平速度（×2）
    "dcm.nx",
    "dcm.nz"
    // 18,19 DCM 归一化位置（0=中心，±1=域边缘）
  ];
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].rot.x`, `joint[${i}].rot.y`, `joint[${i}].rot.z`);
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].relw.x`, `joint[${i}].relw.y`, `joint[${i}].relw.z`);
  out.push("sole.l.y", "sole.r.y");
  out.push("foot.l.load", "foot.r.load");
  out.push("swing.l", "swing.r");
  out.push("foot.l.dx", "foot.r.dx", "foot.l.dz", "foot.r.dz");
  out.push("leg.l.dx", "leg.l.dy", "leg.l.len", "leg.r.dx", "leg.r.dy", "leg.r.len");
  return out;
}
function brainParamCount(s) {
  return s.inputs * s.hidden + s.hidden + s.hidden * s.outputs + s.outputs;
}
function brainLayout(s) {
  const w1 = 0;
  const b1 = s.inputs * s.hidden;
  const w2 = b1 + s.hidden;
  const b2 = w2 + s.hidden * s.outputs;
  return { w1, b1, w2, b2, total: b2 + s.outputs };
}
function brainForward(s, p, x, hidden, out) {
  const L = brainLayout(s);
  for (let h = 0; h < s.hidden; h++) {
    let acc = p[L.b1 + h];
    const row = L.w1 + h * s.inputs;
    for (let i = 0; i < s.inputs; i++) acc += p[row + i] * x[i];
    hidden[h] = Math.tanh(acc);
  }
  for (let o = 0; o < s.outputs; o++) {
    let acc = p[L.b2 + o];
    const row = L.w2 + o * s.hidden;
    for (let h = 0; h < s.hidden; h++) acc += p[row + h] * hidden[h];
    out[o] = Math.tanh(acc);
  }
}
var HIDDEN_UNITS, BRAIN_SHAPE, INPUT_LAYOUT, INPUT_COUNT, OUTPUT_PER_JOINT;
var init_brain = __esm({
  "src/core/brain.ts"() {
    "use strict";
    HIDDEN_UNITS = 32;
    BRAIN_SHAPE = shapeForJoints(9);
    INPUT_LAYOUT = inputLayout(12);
    INPUT_COUNT = 36 + 6 * 12;
    OUTPUT_PER_JOINT = 3;
  }
});

// src/core/posture.ts
function newCom() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}
function newSupport() {
  return { cx: 0, cz: 0, halfX: 0, halfZ: 0, halfZActive: 0, contactN: 0 };
}
function omegaAt(comY) {
  return Math.sqrt(GRAVITY_Y / (comY > 0.05 ? comY : 0.05));
}
function dcm(x, vx, omega) {
  return x + vx / omega;
}
function readCom(doll, out) {
  let mt = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of doll.bodies) {
    const m = b.mass();
    const c = b.worldCom();
    const v = b.linvel();
    mt += m;
    x += m * c.x;
    y += m * c.y;
    z += m * c.z;
    vx += m * v.x;
    vy += m * v.y;
    vz += m * v.z;
  }
  if (mt <= 0) {
    out.x = out.y = out.z = out.vx = out.vy = out.vz = 0;
    return out;
  }
  out.x = x / mt;
  out.y = y / mt;
  out.z = z / mt;
  out.vx = vx / mt;
  out.vy = vy / mt;
  out.vz = vz / mt;
  return out;
}
function rotQ(qx, qy, qz, qw, vx, vy, vz, out) {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
function soleBodyIndex(doll, side) {
  return doll.indexByKey.get(`foot_${side}`) ?? doll.indexByKey.get(side === "l" ? "shin_l" : "shin_r");
}
function footRect(doll, side, out) {
  const idx = soleBodyIndex(doll, side);
  if (idx === void 0) return false;
  const bd = doll.sk.bodies[idx];
  const b = doll.bodies[idx];
  const t = b.translation();
  const q = b.rotation();
  const sole = bd.colliders.find((c) => c.shape === "cuboid");
  const hx = sole && sole.shape === "cuboid" ? sole.hx : 0.02;
  const hy = sole && sole.shape === "cuboid" ? sole.hy : 0.01;
  const hz = sole && sole.shape === "cuboid" ? sole.hz : 0.02;
  const oy = (sole ? sole.offsetY : -bd.length / 2) - hy;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, minY = Infinity;
  for (let si = 0; si < 4; si++) {
    rotQ(q.x, q.y, q.z, q.w, (si & 1 ? 1 : -1) * hx, oy, (si & 2 ? 1 : -1) * hz, V3);
    const wx = t.x + V3[0], wy = t.y + V3[1], wz = t.z + V3[2];
    if (wx < x0) x0 = wx;
    if (wx > x1) x1 = wx;
    if (wz < z0) z0 = wz;
    if (wz > z1) z1 = wz;
    if (wy < minY) minY = wy;
  }
  out.x0 = x0;
  out.x1 = x1;
  out.z0 = z0;
  out.z1 = z1;
  out.minY = minY;
  out.cx = (x0 + x1) / 2;
  out.cz = (z0 + z1) / 2;
  return minY <= CONTACT_Y;
}
function footGrounded(doll, side) {
  return doll.footGrounded(side === "l" ? 0 : 1);
}
function readSupport(doll, out) {
  const inL = footRect(doll, "l", RECT_L) && doll.footGrounded(0);
  const inR = footRect(doll, "r", RECT_R) && doll.footGrounded(1);
  const wLx = RECT_L.x1 - RECT_L.x0, wRx = RECT_R.x1 - RECT_R.x0;
  const wLz = RECT_L.z1 - RECT_L.z0, wRz = RECT_R.z1 - RECT_R.z0;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  if (inL) {
    x0 = Math.min(x0, RECT_L.x0);
    x1 = Math.max(x1, RECT_L.x1);
    z0 = Math.min(z0, RECT_L.z0);
    z1 = Math.max(z1, RECT_L.z1);
    n++;
  }
  if (inR) {
    x0 = Math.min(x0, RECT_R.x0);
    x1 = Math.max(x1, RECT_R.x1);
    z0 = Math.min(z0, RECT_R.z0);
    z1 = Math.max(z1, RECT_R.z1);
    n++;
  }
  if (n === 0) {
    x0 = Math.min(RECT_L.x0, RECT_R.x0);
    x1 = Math.max(RECT_L.x1, RECT_R.x1);
    z0 = Math.min(RECT_L.z0, RECT_R.z0);
    z1 = Math.max(RECT_L.z1, RECT_R.z1);
  }
  let cx, cz, halfX, halfZ;
  if (inL && inR) {
    cx = (RECT_L.cx + RECT_R.cx) / 2;
    cz = (RECT_L.cz + RECT_R.cz) / 2;
    halfX = (wLx + wRx) / 4;
    halfZ = (wLz + wRz) / 4;
  } else if (inL) {
    cx = RECT_L.cx;
    cz = RECT_L.cz;
    halfX = wLx / 2;
    halfZ = wLz / 2;
  } else if (inR) {
    cx = RECT_R.cx;
    cz = RECT_R.cz;
    halfX = wRx / 2;
    halfZ = wRz / 2;
  } else {
    cx = (RECT_L.cx + RECT_R.cx) / 2;
    cz = (RECT_L.cz + RECT_R.cz) / 2;
    halfX = (wLx + wRx) / 4;
    halfZ = (wLz + wRz) / 4;
  }
  out.cx = cx;
  out.cz = cz;
  out.halfX = Math.max(MIN_HALF, halfX);
  out.halfZ = Math.max(MIN_HALF, halfZ);
  out.halfZActive = Math.max(out.halfZ, (z1 - z0) / 2);
  out.contactN = n;
  return out;
}
function dcmExcess(xi, center, half) {
  const e = Math.abs(xi - center) / half - 1;
  return e > 0 ? e : 0;
}
var GRAVITY_Y, CONTACT_Y, MIN_HALF, RECT_L, RECT_R, V3;
var init_posture = __esm({
  "src/core/posture.ts"() {
    "use strict";
    GRAVITY_Y = 9.81;
    CONTACT_Y = 0.03;
    MIN_HALF = 0.04;
    RECT_L = { x0: 0, x1: 0, z0: 0, z1: 0, minY: 0, cx: 0, cz: 0 };
    RECT_R = { x0: 0, x1: 0, z0: 0, z1: 0, minY: 0, cx: 0, cz: 0 };
    V3 = new Float64Array(3);
  }
});

// src/core/gaitRef.ts
function monotoneAt(ref, t) {
  const n = ref.length;
  const x = (t % 1 + 1) % 1 * 100;
  let i = 0;
  while (i < n - 2 && x > ref[i + 1][0]) i++;
  const [x0, y0] = ref[i];
  const [x1, y1] = ref[i + 1];
  const h = x1 - x0;
  if (h <= 1e-9) return y0;
  const u = (x - x0) / h;
  const secant = (j) => {
    const [xa, ya] = ref[j];
    const [xb, yb] = ref[j + 1];
    const hh = xb - xa;
    return hh <= 1e-9 ? 0 : (yb - ya) / hh;
  };
  const d = (j) => {
    if (j < 0 || j >= n - 1) return 0;
    const s = secant(j);
    const sa = j > 0 ? secant(j - 1) : s;
    const sb = j + 2 < n ? secant(j + 1) : s;
    if (s * sa <= 0 || s * sb <= 0) return 0;
    const m = Math.min(Math.abs(s), 3 * Math.abs(sa), 3 * Math.abs(sb));
    return s > 0 ? m : -m;
  };
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * (d(i) * h) + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * (d(i + 1) * h);
}
function scoreLeg(t, hipRad, kneeRad, ampScale = AMP_SCALE_DEFAULT) {
  const hipDeg = hipRad * R2D * RIG_SIGN.hip;
  const kneeDeg = kneeRad * R2D * RIG_SIGN.knee;
  const hipRef = hipRefDeg(t);
  const kneeRef = kneeRefDeg(t);
  const hipAmp = hipROM() * ampScale;
  const kneeAmp = kneeROM() * ampScale;
  const hipCtr = (hipRef + hipRefDeg(t + 0.5)) / 2;
  const kneeCtr = (kneeRef + kneeRefDeg(t + 0.5)) / 2;
  const hipTgt = hipCtr + (hipRef - hipCtr) * ampScale;
  const kneeTgt = kneeCtr + (kneeRef - kneeCtr) * ampScale;
  return {
    hip: shapeScore(hipDeg, hipTgt, hipAmp),
    knee: shapeScore(kneeDeg, kneeTgt, kneeAmp),
    phase: (t % 1 + 1) % 1
  };
}
function shapeScore(actual, target, amp) {
  const e = Math.abs(actual - target);
  const tol = TOLERANCE_DEG;
  if (e <= tol) return 1;
  const over = (e - tol) / Math.max(1e-6, amp);
  return Math.exp(-3 * over * over);
}
var clamp01, D2R, GC_IC, GC_LR, GC_MS, GC_TS, GC_PS, GC_SW, GC_PEAK, GC_LATE, GC_END, KNEE_REF, HIP_REF, STANCE_FRAC, TOLERANCE_DEG, kneeRefDeg, hipRefDeg, RIG_SIGN, AMP_SCALE_DEFAULT, R2D, hipROM, kneeROM, LEAD_MIN, LEAD_MAX, PREACT_RATIO, PelvisFirstTracker;
var init_gaitRef = __esm({
  "src/core/gaitRef.ts"() {
    "use strict";
    clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
    D2R = Math.PI / 180;
    GC_IC = 0;
    GC_LR = 10;
    GC_MS = 30;
    GC_TS = 50;
    GC_PS = 62;
    GC_SW = 70;
    GC_PEAK = 78;
    GC_LATE = 90;
    GC_END = 100;
    KNEE_REF = [
      [GC_IC, 5],
      [GC_LR, 18],
      [GC_MS, 8],
      [GC_TS, 20],
      [GC_PS, 40],
      [GC_SW, 58],
      [GC_PEAK, 66],
      [GC_LATE, 20],
      [GC_END, 5]
    ];
    HIP_REF = [
      [GC_IC, 25],
      [GC_LR, 25],
      [GC_MS, 2],
      [GC_TS, -8],
      [GC_PS, 15],
      [GC_SW, 28],
      [GC_PEAK, 30],
      [GC_LATE, 27],
      [GC_END, 25]
    ];
    STANCE_FRAC = 0.6;
    TOLERANCE_DEG = 5;
    kneeRefDeg = (t) => monotoneAt(KNEE_REF, t);
    hipRefDeg = (t) => monotoneAt(HIP_REF, t);
    RIG_SIGN = { hip: 1, knee: -1 };
    AMP_SCALE_DEFAULT = 1;
    R2D = 180 / Math.PI;
    hipROM = () => 30 - -8;
    kneeROM = () => 66 - 0;
    LEAD_MIN = 0.05;
    LEAD_MAX = 0.25;
    PREACT_RATIO = 0.3;
    PelvisFirstTracker = class {
      /** 低通后的髋/膝角速度（rad/s），EMA */
      hv = 0;
      kv = 0;
      hvMax = 0;
      // 本步髋速度峰值（用来归一化"用力"）
      // ★ 用**峰值时刻**而不是"启动时刻"：实测本 rig 髋/膝的 |相对角速度| 峰值有
      //   11~19 rad/s，而阈值只要 0.35 rad/s —— 两者会在**同一控制拍内**先后越过，
      //   于是"膝滞后髋"恒等于 0 ms，完全测不出东西（我第一版就是这么白测的）。
      //   峰值时刻是同一个意思的稳健版本：一整步里髋的速度峰值应该**先于**膝出现。
      hipPeakT = -1;
      kneePeakT = -1;
      hipPeakV = 0;
      kneePeakV = 0;
      t = 0;
      /** 预激活采样窗（触地前 100 ms 内的髋速度均值） */
      preAcc = 0;
      preN = 0;
      wasGround = true;
      /** 本步的髋是否在**触地前**就已经动（文献①的核心指标） */
      preActive = 0;
      lastLead = 0;
      // 最近一次完整测出的领先量（s）
      leadSum = 0;
      leadN = 0;
      reset() {
        this.hv = 0;
        this.kv = 0;
        this.hvMax = 0;
        this.hipPeakT = -1;
        this.kneePeakT = -1;
        this.hipPeakV = 0;
        this.kneePeakV = 0;
        this.t = 0;
        this.preAcc = 0;
        this.preN = 0;
        this.wasGround = true;
        this.preActive = 0;
        this.leadSum = 0;
        this.leadN = 0;
      }
      /** 最近一次测出的"膝滞后髋"多少秒（正 = 髋先动，正确的方向） */
      get leadSec() {
        return this.lastLead;
      }
      /** 迄今测到的平均领先量 */
      get meanLead() {
        return this.leadN > 0 ? this.leadSum / this.leadN : 0;
      }
      get preActiveRatio() {
        return this.preActive;
      }
      /**
       * @param hipVel  髋矢状角速度（rad/s，正 = 屈曲方向）
       * @param kneeVel 膝矢状角速度（rad/s）
       * @param grounded 该脚是否着地
       * @param onsetThr 启动阈值（rad/s），低于它算"静止"
       */
      step(hipVel, kneeVel, grounded, dt, peakThr = 0.8) {
        const a = 1 - Math.exp(-dt / 0.03);
        this.hv += (hipVel - this.hv) * a;
        this.kv += (kneeVel - this.kv) * a;
        this.t += dt;
        this.hvMax = Math.max(this.hvMax, Math.abs(this.hv));
        if (Math.abs(this.hv) > peakThr && Math.abs(this.hv) > Math.abs(this.hipPeakV)) {
          this.hipPeakV = this.hv;
          this.hipPeakT = this.t;
        }
        if (Math.abs(this.kv) > peakThr && Math.abs(this.kv) > Math.abs(this.kneePeakV)) {
          this.kneePeakV = this.kv;
          this.kneePeakT = this.t;
        }
        if (!grounded) {
          this.preAcc += Math.abs(this.hv);
          this.preN++;
        }
        if (grounded && !this.wasGround) {
          if (this.preN > 0 && this.hvMax > 1e-6) {
            this.preActive = this.preAcc / this.preN / this.hvMax;
          }
          if (this.hipPeakT >= 0 && this.kneePeakT >= 0) {
            this.lastLead = this.kneePeakT - this.hipPeakT;
            this.leadSum += this.lastLead;
            this.leadN++;
          }
          this.t = 0;
          this.hipPeakT = -1;
          this.kneePeakT = -1;
          this.hipPeakV = 0;
          this.kneePeakV = 0;
          this.hvMax = 0;
          this.preAcc = 0;
          this.preN = 0;
          this.preActive = 0;
        }
        this.wasGround = grounded;
      }
      /**
       * 逐帧"盆骨优先"分（0..1）：当前这一步的领先关系好不好。
       * · 髋领先 50~250 ms ⇒ 满分（文献口径）
       * · 膝先动（领先量 < 0）⇒ **负分**（这是要治的病）
       * · 髋领先太多 ⇒ 衰减（脱节）
       * · 还没测出领先量（还没触地）⇒ 用"预激活程度"给部分分
       */
      score() {
        const pre = this.preActive > 0 ? clamp01(this.preActive / PREACT_RATIO) : 0;
        if (this.leadN === 0) return pre * 0.5;
        const L = this.lastLead;
        if (L < 0) return -Math.min(1, -L / 0.2);
        if (L < LEAD_MIN) return L / LEAD_MIN * 0.9;
        if (L <= LEAD_MAX) return 1;
        return Math.exp(-3 * ((L - LEAD_MAX) / 0.15) ** 2);
      }
    };
  }
});

// src/core/stability.ts
function marginOfStability(comX, comVx, om, supEdgeX, comZ, comVz, supEdgeZ) {
  const xcoM = comX + (om > 1e-3 ? comVx / om : 0);
  const zcoM = comZ + (om > 1e-3 ? comVz / om : 0);
  return { x: supEdgeX - xcoM, z: supEdgeZ - zcoM };
}
function cadenceScore(medianCycleSec, target = TARGET_CYCLE, sigma = 0.45) {
  if (!(medianCycleSec > 0)) return 0;
  const d = (medianCycleSec - target) / sigma;
  return Math.exp(-d * d);
}
function stepLenScore(stepLenM, footLenM) {
  if (footLenM <= 1e-6) return 0;
  const f = stepLenM / footLenM;
  const [lo, hi] = STEP_LEN_IN_FEET;
  if (f >= lo && f <= hi) return 1;
  const d = f < lo ? lo - f : f - hi;
  return Math.max(0, 1 - d / 1.5);
}
var clamp012, MIN_SWING, SETTLE_WIN, MOS_TARGET, MIN_CYCLE, MIN_CLEARANCE, TARGET_CYCLE, STEP_LEN_IN_FEET, mosBand, StepSettleTracker;
var init_stability = __esm({
  "src/core/stability.ts"() {
    "use strict";
    clamp012 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
    MIN_SWING = 0.28;
    SETTLE_WIN = 0.45;
    MOS_TARGET = 0.3;
    MIN_CYCLE = 1;
    MIN_CLEARANCE = 0.03;
    TARGET_CYCLE = 1;
    STEP_LEN_IN_FEET = [2, 3];
    mosBand = (mos) => {
      if (mos < 0) return -clamp012(-mos / 0.25);
      if (mos <= MOS_TARGET) return clamp012(mos / MOS_TARGET);
      return Math.exp(-2 * ((mos - MOS_TARGET) / 0.4) ** 2);
    };
    StepSettleTracker = class _StepSettleTracker {
      /** 脚长（m）：步长目标"2~3 个脚长"要用（见 STEP_LEN_IN_FEET） */
      footLenM = 0.22;
      // ⚠ 初始必须是 **settle**（"正站着"），不是 swing。
      //   我第一版初始化成 'swing'，结果一条**从不离地**的腿被当成"刚落地、摆动 0 秒"
      //   ⇒ 站桩的镇定器被判了 26 次"摆动太快"（实测），奖励完全反了。
      phase = "settle";
      swungTicks = 0;
      // 本次离地确实观测到的帧数（0 = 一直踩着）
      // ★ 接触去抖：Rapier 的接触信号会**抖动**（脚在空中偶发一帧接地）。
      //   不去抖的话，teacher 实测被判了 9 次"摆动太快"——摆动计时被那一帧清零。
      airRun = 0;
      gndRun = 0;
      static MIN_RUN = 2;
      // 连续 2 帧才算真的换状态
      /**
       * ★ 构成"一步"所需的**最小腾空帧数**（4 帧 ≈ 33 ms）。
       *   没有它的话，接触抖动（站桩时脚会偶发 2 帧"离地"）会被当成迈步：
       *   实测站着的镇定器因此拿到 **24 个结算步**。33 ms 的门槛把抖动全部挡掉，
       *   同时远小于 MIN_SWING=0.28 s，不会误伤真正的短摆动。
       */
      static MIN_FLIGHT = 4;
      tSwing = 0;
      tSettle = 0;
      mosMin = Infinity;
      // 本步 settle 窗内的 MoS 最小值
      mosEnd = 0;
      // settle 窗**结束**时的 MoS（"最后稳住了"的判据）
      mosAtTouch = 0;
      // 触地瞬间的 MoS（用来判"这一步稳不稳"）
      credit = 0;
      // 本步结算出的分
      tSinceLast = 1e9;
      // 距上次结算过了多久（用于最小步间隔）
      accCredit = 0;
      // 累计结算分（渐进塑形，进适应度用）
      // ★ 步长记账：**只在结算步上累计**（稳不住 ⇒ 步长一分不给，这是"先稳定步幅"的落点）
      accLenScore = 0;
      lenSum = 0;
      lenSumN = 0;
      prevTouchX = NaN;
      lastStepLen = 0;
      tooFast = 0;
      settled = 0;
      unstableSteps = 0;
      flights = 0;
      // 被识别为"一步"的次数（不论稳不稳）
      recovered = 0;
      /** 上一结算步的 MoS（−1 = 还没有） */
      prevTouchMos = -1;
      stepT = 0;
      // 本步总时长
      reset() {
        this.phase = "settle";
        this.tSwing = 0;
        this.tSettle = 0;
        this.swungTicks = 0;
        this.accCredit = 0;
        this.airRun = 0;
        this.gndRun = 0;
        this.tSinceLast = 1e9;
        this.mosMin = Infinity;
        this.mosAtTouch = 0;
        this.credit = 0;
        this.tooFast = 0;
        this.settled = 0;
        this.unstableSteps = 0;
        this.recovered = 0;
        this.flights = 0;
        this.prevTouchMos = -1;
        this.stepT = 0;
      }
      get settleRatio() {
        return this.settled;
      }
      /** 累计结算分（渐进塑形，0..~1 每次） */
      get creditSum() {
        return this.accCredit;
      }
      /** ★ 累计"结算步的步长分"（只有稳住且间隔够的步才计入） */
      get lenCredit() {
        return this.accLenScore;
      }
      /** 结算步的平均步长（m），诊断用 */
      get meanStepLen() {
        return this.lenSumN > 0 ? this.lenSum / this.lenSumN : 0;
      }
      get settledCount() {
        return this.lenSumN;
      }
      /** 诊断快照：为什么没结算（一行看完状态机） */
      debug() {
        return `phase=${this.phase} swung=${this.swungTicks} tSwing=${(this.tSwing * 1e3).toFixed(0)}ms tSettle=${(this.tSettle * 1e3).toFixed(0)}ms mosEnd=${(this.mosEnd * 1e3).toFixed(0)}mm settled=${this.settled} tooFast=${this.tooFast} flights=${this.flights} air=${this.airRun} gnd=${this.gndRun}`;
      }
      get fastCount() {
        return this.tooFast;
      }
      /** 被识别成"一步"的次数（诊断用：机制有没有在工作） */
      get flightCount() {
        return this.flights;
      }
      get unstable() {
        return this.unstableSteps;
      }
      get recoveredCount() {
        return this.recovered;
      }
      /**
       * @param grounded 该脚是否着地（原始接触信号，会抖动）
       * @param mosX 矢状面 MoS（m，正 = 稳定）
       * @param dt
       * @returns 本拍该脚拿到的分（带符号；负 = 罚）
       */
      step(grounded, mosX, dt, footX = NaN) {
        if (grounded) {
          this.gndRun++;
          this.airRun = 0;
        } else {
          this.airRun++;
          this.gndRun = 0;
        }
        const air = this.airRun >= _StepSettleTracker.MIN_RUN;
        const gnd = this.gndRun >= _StepSettleTracker.MIN_RUN;
        if (!air && !gnd) return 0;
        this.tSinceLast += dt;
        if (air) {
          if (this.phase === "settle") {
            this.credit = 0;
            this.phase = "swing";
            this.tSwing = 0;
            this.tSettle = 0;
            this.mosMin = Infinity;
            this.stepT = 0;
          }
          this.swungTicks++;
          this.tSwing += dt;
          return 0;
        }
        if (this.phase === "swing") {
          if (this.swungTicks < _StepSettleTracker.MIN_FLIGHT) {
            this.phase = "settle";
            this.tSettle = 0;
            this.mosMin = mosX;
            this.mosEnd = mosX;
            this.swungTicks = 0;
            return 0;
          }
          this.flights++;
          if (Number.isFinite(footX)) {
            if (Number.isFinite(this.prevTouchX)) this.lastStepLen = footX - this.prevTouchX;
            this.prevTouchX = footX;
          }
          this.mosAtTouch = mosX;
          if (this.mosAtTouch < 0) this.unstableSteps++;
          this.phase = "settle";
          this.tSettle = 0;
          this.mosMin = mosX;
          this.mosEnd = mosX;
          this.stepT = this.tSwing;
          if (this.tSwing < MIN_SWING) {
            this.tooFast++;
            this.credit = 0;
            return 0;
          }
          return 0;
        }
        if (this.swungTicks > 0) this.accCredit -= 0;
        this.tSettle += dt;
        this.mosMin = Math.min(this.mosMin, mosX);
        this.mosEnd = mosX;
        const gain = mosBand(mosX) * dt;
        if (this.tSettle >= SETTLE_WIN - dt * 0.5) {
          const paceFrac = clamp012(this.stepT / MIN_SWING);
          const okStable = this.mosEnd >= 0;
          const cleanStable = this.mosMin >= 0;
          const cycleOk = this.tSinceLast >= MIN_CYCLE;
          if (!cycleOk) this.tooFast++;
          if (okStable && cycleOk) {
            if (this.stepT >= MIN_SWING) this.settled++;
            this.lenSum += this.lastStepLen;
            this.lenSumN++;
            this.accLenScore += stepLenScore(this.lastStepLen, this.footLenM);
            this.credit = paceFrac * (cleanStable ? 1 : 0.7);
            if (this.mosAtTouch < 0) this.recovered++;
          } else {
            this.credit = okStable ? 0 : paceFrac * 0.3;
          }
          this.accCredit += this.credit;
          this.tSinceLast = 0;
          this.prevTouchMos = this.mosAtTouch;
          this.phase = "swing";
          this.tSwing = 0;
          this.tSettle = 0;
          this.mosMin = Infinity;
          this.swungTicks = 0;
        }
        return gain;
      }
      /** 本步结算出的总分（0 或 1，或 0.3） */
      get lastCredit() {
        return this.credit;
      }
    };
  }
});

// src/core/balance.ts
function wholeBodyAngularMomentum(doll, com, out) {
  let lx = 0, ly = 0, lz = 0;
  for (const b of doll.bodies) {
    const m = b.mass();
    const r = b.translation();
    const v = b.linvel();
    const rx = r.x - com.x, ry = r.y - com.y, rz = r.z - com.z;
    lx += m * (ry * v.z - rz * v.y);
    ly += m * (rz * v.x - rx * v.z);
    lz += m * (rx * v.y - ry * v.x);
  }
  out[0] = lx;
  out[1] = ly;
  out[2] = lz;
  return out;
}
var HEAD_MIN, HEAD_MAX, MAX_PITCH, MOS_VOID, WBAM_NORM, WBAM_RATE_NORM, BalanceJudge;
var init_balance = __esm({
  "src/core/balance.ts"() {
    "use strict";
    HEAD_MIN = 0.86;
    HEAD_MAX = 1.06;
    MAX_PITCH = 0.7;
    MOS_VOID = -0.02;
    WBAM_NORM = 6;
    WBAM_RATE_NORM = 40;
    BalanceJudge = class {
      prev = new Float64Array(3);
      prevL = 0;
      hasPrev = false;
      head0 = 0;
      /** 累积不平衡（供奖励逐拍积分） */
      accImb = 0;
      accTicks = 0;
      /** 无效帧数（头塌了）—— 诊断用 */
      badHead = 0;
      wbamMax = 0;
      headMin = 1;
      reset() {
        this.hasPrev = false;
        this.accImb = 0;
        this.accTicks = 0;
        this.badHead = 0;
        this.wbamMax = 0;
        this.headMin = 1;
        this.head0 = 0;
      }
      /** 记录初始站姿的头高（`begin()` 时调用） */
      setRefHead(y) {
        if (this.head0 <= 0) this.head0 = y;
      }
      /** 归一化尺度的标定结果（诊断用） */
      get norms() {
        return { wbam: WBAM_NORM, rate: WBAM_RATE_NORM };
      }
      get stats() {
        return { accImb: this.accImb, ticks: this.accTicks, badHead: this.badHead, wbamMax: this.wbamMax, headMin: this.headMin };
      }
      /**
       * @param lbuf  wholeBodyAngularMomentum 的输出（3 元素）
       * @param headY 当前头（或最高点）世界高度
       * @param dt
       */
      step(lbuf, headY, dt, pitch = 0, mosX = 1) {
        const mag = Math.hypot(lbuf[0], lbuf[1], lbuf[2]);
        let rate = 0;
        if (this.hasPrev) {
          const dl = Math.hypot(lbuf[0] - this.prev[0], lbuf[1] - this.prev[1], lbuf[2] - this.prev[2]);
          rate = dl / Math.max(1e-6, dt);
        }
        this.prev[0] = lbuf[0];
        this.prev[1] = lbuf[1];
        this.prev[2] = lbuf[2];
        this.hasPrev = true;
        const wbam = mag / WBAM_NORM;
        const wbamRate = rate / WBAM_RATE_NORM;
        const headRatio = this.head0 > 0 ? headY / this.head0 : 1;
        const valid = headRatio >= HEAD_MIN && headRatio <= HEAD_MAX && Math.abs(pitch) < MAX_PITCH && mosX > MOS_VOID;
        const imb = Math.tanh(0.7 * wbam) + 0.5 * Math.tanh(0.7 * wbamRate);
        this.accImb += imb * dt;
        this.accTicks += dt;
        if (!valid) this.badHead += dt;
        this.wbamMax = Math.max(this.wbamMax, mag);
        this.headMin = Math.min(this.headMin, headRatio);
        return { wbam, wbamRate, headRatio, valid };
      }
      /**
       * 用一段"已知站得住"的运动标定尺度：取它 |WBAM| 的 90 分位作为 1.0。
       * ⚠ 没有这一步的话，归一化尺度只能靠猜，而惩罚力度就会变成一个说不清来源的魔法数。
       */
      static calibrate(wbamSamples) {
        if (wbamSamples.length < 8) return;
        const s = [...wbamSamples].sort((a, b) => a - b);
        const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
        WBAM_NORM = Math.max(1e-3, p90);
        WBAM_RATE_NORM = Math.max(1e-3, WBAM_NORM * 6);
      }
      /** 测试/探针用：直接指定尺度（不做标定） */
      static setNorms(wbam, rate) {
        WBAM_NORM = Math.max(1e-6, wbam);
        WBAM_RATE_NORM = Math.max(1e-6, rate);
      }
    };
  }
});

// src/core/gaitPhase.ts
function stateLabel(phase, swing, bodyFree) {
  if (phase === "both") return "both \u8FC7\u6E21\uFF08\u53CC\u811A\u7740\u5730\uFF09";
  const s = swing === "l" ? "\u5DE6\u817F" : "\u53F3\u817F";
  return phase === "step" ? `step:${s === "\u5DE6\u817F" ? "L" : "R"} \u8FC8\u6B65\u4E2D\xB7\u8EAB\u4F53\u51BB\u7ED3` : `adjust:${s === "\u5DE6\u817F" ? "L" : "R"} \u7A33\u4F4F\u4E2D\xB7\u8EAB\u4F53\u53EF\u52A8`;
}
var STEP_MIN, ADJUST_MIN, ADJUST_MOS_TOL, W_SHAPE, W_MOS, W_PLACE, W_PELVIS, GaitPhaseMachine;
var init_gaitPhase = __esm({
  "src/core/gaitPhase.ts"() {
    "use strict";
    STEP_MIN = 0.13;
    ADJUST_MIN = 0.9;
    ADJUST_MOS_TOL = 0;
    W_SHAPE = 0.35;
    W_MOS = 0.3;
    W_PLACE = 0.2;
    W_PELVIS = 0.15;
    GaitPhaseMachine = class {
      phase = "both";
      /** ★ 该迈哪条腿（由载荷决定： unloaded 的那条迈） */
      swing = null;
      t = 0;
      tPhase = 0;
      tStep = 0;
      tAdjust = 0;
      mosAcc = 0;
      mosN = 0;
      placeAcc = 0;
      placeN = 0;
      shapeAcc = 0;
      shapeN = 0;
      pelvisAcc = 0;
      lastCredit = 0;
      accCredit = 0;
      nStep = 0;
      nAdjustOk = 0;
      flickers = 0;
      adjSum = 0;
      evs = [];
      peakClr = 0;
      // 本次迈步的离地峰值（诊断）
      mosEnd = 0;
      // 调整窗末的 MoS（诊断）
      reset() {
        this.phase = "both";
        this.tStep = 0;
        this.tAdjust = 0;
        this.mosAcc = 0;
        this.mosN = 0;
        this.placeAcc = 0;
        this.placeN = 0;
        this.shapeAcc = 0;
        this.shapeN = 0;
        this.pelvisAcc = 0;
        this.lastCredit = 0;
        this.accCredit = 0;
        this.nStep = 0;
        this.nAdjustOk = 0;
        this.flickers = 0;
        this.adjSum = 0;
      }
      get now() {
        return this.phase;
      }
      /** ★ 该迈哪条腿（null = 双脚着地，没有"该迈的腿"） */
      get swingLeg() {
        return this.swing;
      }
      /** ★★ 身体该不该动：只有"稳住中"才允许动（用户："迈步时身体别动，落地后再动"） */
      get bodyFree() {
        return this.phase === "adjust";
      }
      /** 调试标签 */
      get label() {
        return stateLabel(this.phase, this.swing, this.bodyFree);
      }
      /** 状态转移轨迹（含"哪个状态没通过"） */
      get trace() {
        return this.evs;
      }
      /** 正在"调整身体"阶段（此时其它项才允许计分） */
      get inAdjust() {
        return this.phase === "adjust";
      }
      /** 刚结算完一个循环（那一帧允许把分记进适应度） */
      get justSettled() {
        return this.lastCredit > 0;
      }
      get tally() {
        return {
          nStep: this.nStep,
          nAdjustOk: this.nAdjustOk,
          lastCredit: this.lastCredit,
          accCredit: this.accCredit,
          lastAdjustSec: this.tAdjust,
          meanAdjustSec: this.nAdjustOk > 0 ? this.adjSum / this.nAdjustOk : 0,
          flickers: this.flickers
        };
      }
      /**
       * 每控制拍喂一次。
       * @param nGround 接地脚数（0/1/2）
       * @param clearance 本次腾空的最大离地高度（m）—— 用来区分"真迈步"和"抖动"
       * @param mosX 矢状面 MoS（m）
       * @param shape 髋/膝贴合文献参考的分数 0..1
       * @param place 落点贴合捕获点的分数 0..1
       * @param pelvis 盆骨先于膝的分数（可为负）
       * @param dt
       */
      step(nGround, clearance, mosX, shape, place, pelvis, dt, swingLeg = null) {
        this.t += dt;
        this.tPhase += dt;
        if (this.tPhase > 0.45) {
          const fail = this.phase === "step" ? this.swing === null ? "\u672A\u6307\u5B9A\u6446\u52A8\u817F" : `\u6446\u52A8\u817F\u672A\u79BB\u5730\u8FBE\u6807\uFF08\u5CF0\u503C ${(this.peakClr * 1e3).toFixed(0)}mm < 30mm\uFF09` : this.phase === "adjust" ? this.mosEnd < 0 ? `\u672A\u7A33\u4F4F\uFF08\u7A97\u672B MoS ${(this.mosEnd * 1e3).toFixed(0)}mm < 0\uFF09` : `\u7A33\u4F4F\u65F6\u957F\u4E0D\u8DB3\uFF08${this.tPhase.toFixed(2)}s < ${ADJUST_MIN}s\uFF09` : "";
          this.evs.push({ t: this.t - this.tPhase, label: this.label, fail, dur: this.tPhase });
          this.tPhase = 0;
        }
        this.swing = swingLeg;
        if (nGround === 1) {
          if (this.phase !== "step") this.peakClr = 0;
          this.peakClr = Math.max(this.peakClr, clearance);
          if (this.phase !== "adjust") {
            this.phase = "step";
            this.tStep += dt;
          }
          if (this.phase === "step" && clearance >= 0.03 && this.tStep >= STEP_MIN) {
            this.phase = "adjust";
            this.nStep++;
            this.tAdjust = 0;
            this.mosAcc = 0;
            this.mosN = 0;
            this.placeAcc = 0;
            this.placeN = 0;
            this.mosEnd = 0;
            this.shapeAcc = 0;
            this.shapeN = 0;
            this.pelvisAcc = 0;
          } else if (this.phase === "step" && clearance < 0.03) {
            this.flickers++;
          }
          return;
        }
        if (nGround === 2) {
          if (this.phase === "adjust") {
            this.tAdjust += dt;
            if (mosX > 0) {
              this.mosAcc += mosX;
              this.mosN++;
            }
            this.mosEnd = mosX;
            this.placeAcc += place;
            this.placeN++;
            this.shapeAcc += shape;
            this.shapeN++;
            this.pelvisAcc += pelvis;
            if (this.tAdjust >= ADJUST_MIN && this.mosN > 0) {
              const mosAvg = this.mosAcc / this.mosN;
              const mosScore = mosAvg > ADJUST_MOS_TOL ? 1 : Math.max(0, 1 + mosAvg / 0.25);
              const placeAvg = this.placeN > 0 ? this.placeAcc / this.placeN : 0;
              const shapeAvg = this.shapeN > 0 ? this.shapeAcc / this.shapeN : 0;
              const pelvisAvg = this.pelvisAcc;
              const credit = W_SHAPE * shapeAvg + W_MOS * mosScore + W_PLACE * placeAvg + W_PELVIS * Math.max(0, Math.min(1, pelvisAvg));
              this.accCredit += credit;
              this.nAdjustOk++;
              this.adjSum += this.tAdjust;
              this.lastCredit = credit;
              this.phase = "both";
              this.tStep = 0;
              this.tAdjust = 0;
            }
            return;
          }
          this.phase = "both";
          this.tStep = 0;
          this.tAdjust = 0;
          this.lastCredit = 0;
          return;
        }
        this.phase = "both";
        this.tStep = 0;
        this.tAdjust = 0;
        this.lastCredit = 0;
      }
    };
  }
});

// src/core/modules.ts
var MODULES, ModuleSet;
var init_modules = __esm({
  "src/core/modules.ts"() {
    "use strict";
    MODULES = [
      { id: "loadShift", label: "\u8F7D\u8377\u8F6C\u79FB", part: "body", phases: ["both", "step", "adjust"], singleOnly: false },
      { id: "altSwitch", label: "\u6362\u652F\u6491\u811A", part: "body", phases: ["both", "step", "adjust"], singleOnly: false },
      // ★★ 相位放开为 **全部三相**（2026-10-02，站立模式必需）。
      //   原来只 `['step','adjust']`，于是**站立模式下 `gp.now` 几乎永远是 `both`**
      //   ⇒ `mod.active('singleSupport', ...)` 恒 false ⇒ `accSingle` 恒 −0.001
      //   ⇒ 站立模式的**主项是死的** ⇒ 12 代收敛到"两脚着地 359/360 帧"的退化解
      //   （实测：把 `single` 权重提到 3.0、把 `quiet` 归零，数字**一位不变**）。
      //   单腿站立本来就不属于任何"迈步相位"，它的判据就是几何接触（一脚离地），
      //   与相位无关 ⇒ 相位门控在这里没有意义，反而把奖励关掉了。
      { id: "singleSupport", label: "\u5355\u652F\u6491\u65F6\u957F", part: "body", phases: ["both", "step", "adjust"], singleOnly: true },
      { id: "cycle", label: "\u8FC8\u6B65\u2192\u8C03\u6574\u5FAA\u73AF", part: "body", phases: ["both", "step", "adjust"], singleOnly: false },
      { id: "stillSwing", label: "\u6446\u52A8\u76F8\u8EAB\u4F53\u51BB\u7ED3", part: "body", phases: ["step"], singleOnly: true },
      { id: "balance", label: "WBAM/MoS \u5E73\u8861", part: "body", phases: ["both", "step", "adjust"], singleOnly: false },
      { id: "distance", label: "\u811A\u51C0\u4F4D\u79FB", part: "body", phases: ["both", "step", "adjust"], singleOnly: false },
      // ★★ 脊椎/CMP 默认**只在「稳住中」相**出力（实测 2026-10-02）：
      //   三相都开着时，单支撑 MoS 从 −487mm 拉到 +79mm（站得住），
      //   但换脚从 4 次掉到 2 次 —— 它在**拿停止前进换稳定**。
      //   ⇒ 摆动相不许脊椎介入（否则躯干跟着摆腿晃，破坏"迈步时身体别动"），
      //     只在落地后的调整相用来纠正身体。
      // ★ 2026-10-02 修正：原来写 `phases: ['adjust']`，但 adjust 相实测 **0 帧**
      //   （连续单支撑攒不够 ADJUST_MIN）⇒ `mod.active('spineSync', ...)` 永远 false
      //   ⇒ **腰一次都没被驱动**，却又是个"看起来在起作用"的假开关（用户："腰部的移动不太对"）。
      //   腰按 Perry 分期应该在**整个支撑相**都能反相旋转（Takemura 2007），不必等 adjust。
      // ★★ 相位收窄为 **`['step']`（仅摆动/迈腿相）**（2026-10-02，文献依据）：
      //   `spineSync` 是**步态反相旋转**机制（Takemura 2007, Sci Rep 2019：
      //   胸廓与骨盆反相旋转，抵消摆动腿的垂直轴角动量）—— 它的**服务对象是摆动腿**，
      //   在没有摆动腿的**静态平衡保持**下没有任何力学理由要开。
      //   而单腿站立的文献结论正相反（Riemann, Myers & Lephart 2003,
      //   *Arch Phys Med Rehabil* 84:36-42）：
      //     · "The **trunk**... appeared to be the **least important** source of
      //       corrective action"
      //     · "significantly **more corrective action occurred between the pelvis and thigh
      //       than between the pelvis and trunk**"
      //     · "the **higher inertia** associated with the trunk may **preclude it from
      //       contributing to the quick adjustments** necessary for single-leg stance
      //       equilibrium"
      //   实测的代价（此前误设为三相全开）：单腿保持平衡时腰仍收到 **−14°** 的躯干旋转指令，
      //   而躯干只实际动了 −2.7° ⇒ 给本就不稳的系统又加了一个大惯量扰动源。
      { id: "spineSync", label: "\u9AA8\u76C6-\u810A\u690E\u53CD\u76F8\uFF08\u4EC5\u6446\u52A8\u76F8\uFF09", part: "spine", phases: ["step"], singleOnly: false },
      { id: "cmBalance", label: "CMP \u8D28\u5FC3\u529B\u77E9", part: "spine", phases: ["both", "step", "adjust"], singleOnly: false },
      { id: "pelvisFirst", label: "\u76C6\u9AA8/\u9ACB\u4F18\u5148", part: "l", phases: ["step", "adjust"], singleOnly: true },
      { id: "refShape", label: "\u6587\u732E\u9ACB\u819D\u5F62\u72B6", part: "l", phases: ["step", "adjust"], singleOnly: true },
      { id: "placement", label: "\u843D\u70B9/\u6355\u83B7\u70B9", part: "l", phases: ["step", "adjust"], singleOnly: true },
      { id: "stepClearance", label: "\u79BB\u5730\u9AD8\u5EA6", part: "l", phases: ["step"], singleOnly: true },
      { id: "stepLength", label: "\u6B65\u957F", part: "l", phases: ["step", "adjust"], singleOnly: false }
    ];
    ModuleSet = class {
      off = /* @__PURE__ */ new Set();
      // 代码手动关掉的（总开关优先于其它一切）
      byPart = /* @__PURE__ */ new Map();
      constructor() {
        for (const d of MODULES) {
          const a = this.byPart.get(d.part);
          if (a) a.push(d);
          else this.byPart.set(d.part, [d]);
        }
      }
      /** ★ 代码手动开关某模块（优先级最高）。返回是否成功。 */
      enable(id, on = true) {
        if (on) this.off.delete(id);
        else this.off.add(id);
        return this;
      }
      /** 批量关掉某归属的全部模块，例如"这一段不要动脊椎" */
      enablePart(part, on) {
        for (const d of this.byPart.get(part) ?? []) {
          if (on) this.off.delete(d.id);
          else this.off.add(d.id);
        }
        return this;
      }
      reset() {
        this.off.clear();
        return this;
      }
      isManuallyOff(id) {
        return this.off.has(id);
      }
      /**
       * ★ 模块 id 定义里写的是 `part: 'l'`（代表"逐腿模块"），
       *   实际激活要按**具体那条腿**判断：`active('refShape', 'l')` / `active('refShape', 'r')`。
       *   归属为 'body'/'spine' 的模块忽略 limb 参数。
       */
      resolve(id, limb) {
        const d = MODULES.find((m) => m.id === id);
        if (!d) return null;
        if (d.part === "body" || d.part === "spine") return d;
        return limb === d.part ? d : null;
      }
      /** ★ 模块此刻是否起作用 */
      active(id, phase, nGround, limb = null) {
        const d = this.resolve(id, limb);
        if (!d) return false;
        if (this.off.has(id)) return false;
        if (!d.phases.includes(phase)) return false;
        if (d.singleOnly && nGround !== 1) return false;
        return true;
      }
      /** 某模块此刻为什么不起作用（空 = 起着作用）。调试直接打印这句话。 */
      why(id, phase, nGround, limb = null) {
        const d = this.resolve(id, limb);
        if (!d) return limb ? `\u4E0D\u5C5E\u4E8E${limb === "l" ? "\u5DE6\u817F" : "\u53F3\u817F"}\uFF08\u8FD9\u662F\u9010\u817F\u6A21\u5757\uFF09` : "\u672A\u77E5\u6A21\u5757";
        if (this.off.has(id)) return "\u88AB\u4EE3\u7801\u5173\u95ED";
        if (!d.phases.includes(phase)) return `\u5F53\u524D\u662F\u300C${phase}\u300D\u76F8\uFF0C\u8BE5\u6A21\u5757\u53EA\u5728 ${d.phases.join("/")} \u76F8\u751F\u6548`;
        if (d.singleOnly && nGround !== 1) return `\u8981\u6C42\u5355\u652F\u6491\uFF0C\u5F53\u524D\u652F\u6491\u811A\u6570=${nGround}`;
        return "";
      }
      /**
       * ★ 改某模块**在哪些相**生效（用户："需要代码操控什么时候什么模块起作用"）。
       *   实测用途：脊椎三相全开 ⇒ MoS 变好但换脚减半；只在 `adjust` 相 ⇒ 两头都要。
       *   传空数组 = 等价于永远关闭。
       */
      setPhases(id, phases) {
        const d = MODULES.find((m) => m.id === id);
        if (d) d.phases = phases.slice();
        return this;
      }
      /** 调试：当前每个模块 开/关 + 原因（左腿右腿分列，脊椎单列） */
      /**
       * ★★★ 伺服层登记：**这类模块永远待命，但只"修正"、从不发令**（用户 2026-10-02）。
       *   它们被允许在**任何相**起作用 —— 因为稳定不是发令出来的，是一直做的。
       *   人体对应：落点/前馈、MoS 反射、踝策略、躯干稳定，都是持续在线的伺服。
       */
      servo(id) {
        const d = MODULES.find((m) => m.id === id);
        if (d) {
          d.phases = ["both", "step", "adjust"];
          d.singleOnly = false;
        }
        return this;
      }
      /** 批量登记伺服 */
      servoAll(ids) {
        for (const i of ids) this.servo(i);
        return this;
      }
      /** 取某模块当前登记的相列表（调试用） */
      phasesOf(id) {
        return MODULES.find((m) => m.id === id)?.phases ?? [];
      }
      report(phase, nGround) {
        const out = [];
        for (const leg of ["l", "r"]) {
          for (const d of this.byPart.get(leg) ?? []) {
            const w = this.why(d.id, phase, nGround, leg);
            out.push(`  ${w ? "\u2717" : "\u2713"} [${leg === "l" ? "\u5DE6\u817F" : "\u53F3\u817F"}] ${d.label}${w ? "\uFF1A" + w : "\uFF1A\u751F\u6548"}`);
          }
        }
        for (const part of ["spine", "body"]) {
          for (const d of this.byPart.get(part) ?? []) {
            const w = this.why(d.id, phase, nGround, null);
            out.push(`  ${w ? "\u2717" : "\u2713"} [${part === "spine" ? "\u810A\u690E" : "\u8EAB\u4F53"}] ${d.label}${w ? "\uFF1A" + w : "\uFF1A\u751F\u6548"}`);
          }
        }
        return out;
      }
    };
  }
});

// src/core/commander.ts
function orderLabel(o) {
  if (o === "legL") return "\u53D1\u4EE4\uFF1A\u8FC8\u5DE6\u817F";
  if (o === "legR") return "\u53D1\u4EE4\uFF1A\u8FC8\u53F3\u817F";
  if (o === "waist") return "\u53D1\u4EE4\uFF1A\u8F6C\u8170\u8C03\u8EAB";
  return "\u53D1\u4EE4\uFF1A\u65E0";
}
function orderLeg(o) {
  return o === "legL" ? "l" : o === "legR" ? "r" : null;
}
var GaitCommander;
var init_commander = __esm({
  "src/core/commander.ts"() {
    "use strict";
    GaitCommander = class {
      constructor(seq = ["legL", "waist", "legR", "waist"], o = { stepPeriod: 1.6, jitter: 0.15, waistShare: 0.5 }) {
        this.o = o;
        this.seq = seq;
        let s = 12345;
        this.rand = o.rand ?? (() => {
          s = s * 1103515245 + 12345 & 2147483647;
          return s / 2147483647;
        });
      }
      /** 固定顺序：腿 → 腰 → 腿 → 腰 → …（用户指定的节奏） */
      seq;
      idx = 0;
      tCur = 0;
      tAbs = 0;
      // ★ 绝对时间：时间线要显示真实时刻，不是恒为 0
      tLast = -1;
      dNeed = -1;
      // ★ 本条令的时长（发令时抽一次抖动并锁定）
      cur = null;
      lastDelayed = false;
      rand;
      /** 发令时间线（调试） */
      events = [];
      /** 本回合发了多少条令 */
      nOrders = 0;
      reset() {
        this.idx = 0;
        this.tCur = 0;
        this.tAbs = 0;
        this.tLast = -1;
        this.dNeed = -1;
        this.cur = null;
        this.events.length = 0;
        this.nOrders = 0;
      }
      get now() {
        return this.cur;
      }
      get label() {
        return orderLabel(this.cur);
      }
      /**
       * 推进发令者。
       * @param dt       控制周期
       * @param ready    **伺服层的反馈**："上一个动作已经稳住/落地了，可以发下一条令"。
       *                 发令者等这个才走 —— 这就是"其余模块进行稳定"的接口。
       */
      step(dt, ready) {
        this.tCur += dt;
        this.tAbs += dt;
        if (this.dNeed < 0) {
          const base = this.o.stepPeriod / 2 * (this.cur === "waist" ? this.o.waistShare : 2 - this.o.waistShare);
          this.dNeed = Math.max(0, base * (1 + (this.rand() * 2 - 1) * this.o.jitter));
        }
        const canGo = this.tCur >= this.dNeed && ready;
        if (!canGo) return;
        if (!this.cur) {
          this.cur = this.seq[this.idx];
          this.tCur = 0;
          this.tLast = this.tAbs;
          this.nOrders++;
          this.events.push({ t: this.tAbs, order: this.cur, gap: 0, delayed: false });
          return;
        }
        const gap = this.tCur;
        const wasDelayed = gap > this.dNeed + 0.05;
        this.idx = (this.idx + 1) % this.seq.length;
        this.cur = this.seq[this.idx];
        this.tCur = 0;
        this.dNeed = -1;
        this.lastDelayed = wasDelayed;
        this.nOrders++;
        this.events.push({ t: this.tAbs, order: this.cur, gap, delayed: wasDelayed });
      }
      get wasDelayed() {
        return this.lastDelayed;
      }
      /** 调试时间线 */
      timeline() {
        return this.events.map((e) => `${e.t.toFixed(2)}s ${orderLabel(e.order)}`).join("  \u2192  ");
      }
    };
  }
});

// src/core/walkReward.ts
function phi(err) {
  return Math.exp(-(err * err) / 0.25);
}
var AIR_TARGET, JOINT_MOVE_TARGET, TARGET_VX, MOVE_JOINTS;
var init_walkReward = __esm({
  "src/core/walkReward.ts"() {
    "use strict";
    AIR_TARGET = 0.5;
    JOINT_MOVE_TARGET = 1;
    TARGET_VX = 0.5;
    MOVE_JOINTS = ["hip_l", "hip_r", "knee_l", "knee_r"];
  }
});

// src/core/sim.ts
var sim_exports = {};
__export(sim_exports, {
  DEFAULT_SIM: () => DEFAULT_SIM,
  STAND_BOTH_FEET: () => STAND_BOTH_FEET,
  STAND_W: () => STAND_W,
  Sim: () => Sim,
  W: () => W
});
var SETTLE_HOLD, MOVE_SET, WALK_REWARD_KEYS, STAND_W, DEFAULT_SIM, W, STAND_BOTH_FEET, ZERO2, Sim;
var init_sim = __esm({
  "src/core/sim.ts"() {
    "use strict";
    init_rapier();
    init_ragdoll();
    init_brain();
    init_posture();
    init_gaitRef();
    init_stability();
    init_balance();
    init_gaitPhase();
    init_modules();
    init_commander();
    init_walkReward();
    init_skeleton();
    SETTLE_HOLD = 0.45;
    MOVE_SET = new Set(MOVE_JOINTS);
    WALK_REWARD_KEYS = [
      // 前进 / 姿态
      "velTrack",
      "yawTrack",
      "lateral",
      "tiltRate",
      "upright",
      "height",
      // 迈步本体
      "lift",
      "single",
      "shift",
      "refHip",
      "refKnee",
      "pelvisFirst",
      // ★ 诊断：盆骨优先**分腿**（左/右/短板腿）—— 不进 total，只为"说清是哪条腿"
      "pelvisFirstL",
      "pelvisFirstR",
      "pelvisWorst",
      // 迈步 → 调整 的顺序结构
      "settle",
      "stepPace",
      "moS",
      "imbalance",
      "stepLen",
      "placement",
      "cycle",
      "stillSwing",
      // 关节运动与代价
      "jointMove",
      "jointMotion",
      "torque",
      "actRate",
      "energy",
      "survive"
    ];
    STAND_W = {
      alive: 1,
      // 存活（s）
      single: 3,
      // ★主项：恰好一脚着地的时间积分
      upright: 0.8,
      // 躯干直立
      height: 1.2,
      // 高度不塌
      lateral: 6,
      // 侧向不漂（单腿时权重调高）
      tiltRate: 0.05
    };
    DEFAULT_SIM = {
      driver: "brain",
      physicsHz: 120,
      controlHz: 60,
      duration: 6,
      mode: "walk",
      gaitHz: 1.15,
      stepVMin: 0.05,
      shiftCapSec: 1.5,
      swingDuty: 0.45,
      stepMinDx: 0.05,
      // ★ 一次有效迈步至少净前进 5 cm（**先用小阈值**，见 stepMinDxMax 课程）
      stepMaxDz: 0.06,
      // 同一步内横向漂移上限 6 cm（约 27° 航向角 ⇒ 算"直线"）
      stepMinTotal: 0.15,
      // 累计前进不足 15 cm 时一律不给步数分
      stepMinDxMax: 0.3,
      holdMaxSec: 1.2,
      // ★ 收紧：每迈一步最多换 1.2 s 的"站稳"分 ⇒ 循环要快
      stepDecay: 0.6,
      // 第 2 步 ×0.6、第 3 步 ×0.36 …（"逐渐减弱"）
      stepMinGap: 0.2,
      // ★ 收紧：两步至少隔 0.20 s，否则算"抢步"扣分（稳住加分与抢步扣分的间隔要小）
      stillGrace: 0.25,
      // ★ 收紧：循环外只免费站 0.25 s，静止罚很快就上
      stillRamp: 1.5,
      // 之后 1.5 s 内扣分速率爬到 1×，再往上封 3×   // 位移门槛课程上限（见 SimConfig.stepMinDxMax）
      solverIterations: 16,
      contactHz: 0,
      // ★ 默认关 ⇒ 行为与重构前逐位一致（改它必须重跑全部门禁）
      contactDamping: 1,
      /**
       * 躯干高度低于初始的 (1−ratio) ⇒ 判摔倒（截断）。
       * ★ 从 0.62 收紧到 **0.85**：0.62 太松，**往前塌**不算摔 ——
       *   实测零输出基因组（纯阻尼）会在 0.5 s 内塌 0.41 m、然后一路滑出 **1.25 m**，
       *   而躯干高度还有初始的 70% ⇒ 回合不结束、速度跟踪项被它白拿 0.51 分。
       *   经典配方里 crash ⇒ reset 是"结构上不给退化解留时间"，这里同理。
       */
      // ★ 2026-10-02 放宽（用户："摔倒被判定太严了"、"修，不用限制躯干高度了"）。
      //   回读证据（probe-arch「摔倒瞬间」）：
      //     当前阈值下 存活 3.33s，触发瞬间 rH=1.007 / rT=0.415 / rD=0.232，
      //     **碰地刚体=（无）** ⇒ crash 判据（bodyHitGround）根本没有误伤，
      //     真正的杀手是**躯干高度**：躯干 1.064m vs 阈值 0.75×1.429=1.072m，差 8mm 就摔。
      //     而那姿态是"弯腰低头"（倾角仅 34.5°，远未到 83° 阈值），走路时本来就会这样。
      //   ⇒ 按用户要求**取消躯干高度作为摔倒判据**（设 0 = 关闭），
      //     只保留【倾角】与【刚体碰地】两条 —— 后者已验证不会误伤。
      fallHeightRatio: 0,
      // ★ 0 = 不再用躯干高度判摔
      fallAngle: 1.45,
      // 倾角阈值 83°
      /** ★ 头高阈值（m）：由 0.45 → 0.28（实测 rD 只到 0.23，从未触发） */
      headMinHeight: 0.28
    };
    W = {
      // ══════ 走路：walkReward.ts 的 11 项（顺序同那张表）══════
      /** 线速度跟踪 φ(v*−v_x)，v*=0.5 m/s —— 唯一说"往哪儿走"的一项 */
      velTrack: 1,
      /**
       * 角速度跟踪 φ(ω*−ω_y)。★ **默认 0**：φ(0)=1 意味着"完全不自转"是满分，而站桩恰好满分
       *   ⇒ 白拿一份分（实测零输出 +0.5）。自转由 tiltRate 罚（已把 ω_y 纳入）。
       */
      yawTrack: 0,
      /** 侧向漂移 −v_z² */
      lateral: 4,
      /** 翻滚/俯仰角速度罚 */
      tiltRate: 0.05,
      /** 抬腿：Σ_脚 min(1, 腾空/0.5s)·dt —— 交替步态的发动机之一 */
      lift: 1,
      /** 单脚支撑（"一次抬一条"）：恰好一脚着地 +1 / 两脚都飞 −0.5 / 都着地 0 */
      single: 2.5,
      /** ★ 重心转移：∫|载荷左−载荷右|dt（0=双脚均分，1=全压一只脚）。迈步真正的第一步。 */
      shift: 2,
      /**
       * 逐关节"要动"（骨盆/膝盖），每关节另有 moveScale 倍率。
       * ★ 权重必须**小于 velTrack 的潜在收益**（φ(1)−φ(0.5) = 0.63）：否则策略会去"原地抖"
       *   而不是走 —— 实测 jointMove=1.0 时最好个体 5 代只走 0.03 m，训练全部靠抖腿拿分。
       */
      refHip: 1.5,
      refKnee: 1.5,
      pelvisFirst: 2,
      settle: 3,
      stepPace: 1.5,
      moS: 0.5,
      imbalance: 2,
      /**
       * ★★ 步幅分：**只对"结算过的步"付费**（稳住了、间隔够），目标是 **2~3 个脚长**
       *   （Usherwood 2023 碰撞力学：S = 2 或 3 个脚长；原文明确"短于 2 或长于 3 个脚长
       *   的步态显得别扭、也很少观察到"）。
       *   ★ 这就是"先稳定步幅"的落点：抽搐式的高速蹭脚拿不到任何步长分，
       *   速度再快也换不来钱。
       */
      stepLen: 3,
      /**
       * ★ 落点分：摆动脚落点相对**捕获点 ξ** 的误差（Hof 的 XCoM/MoS 体系；综述见
       *   *Control of human gait stability through foot placement*：人主要靠**摆动相的
       *   髋外展肌**调节落点 —— 与"盆骨优先"是同一件事）。
       */
      placement: 1,
      /**
       * ★★★ 顺序结构项：完成一个"迈步 → 调整身体"循环才给分（`gaitPhase.ts`）。
       *   用户 2026-10-02："走路大致是迈步，调整身体，再迈步"、
       *   "迈步间隔太小，无法调整自身平衡"。以前所有走路项都是**独立**时间积分，
       *   任何"一直在动"的动作都能同时满足（实测脚高主频 3.9 Hz 的抖动就能刷 ≈3.5 分）；
       *   改成顺序后，**没走完循环一分不给** —— 这是关住抽搐的结构性办法。
       */
      cycle: 3,
      /**
       * ★★★ "脚往前迈的时候身体别动，脚落地后身体再动"（用户 2026-10-02 的原话）。
       *   诊断：脚在空中的那一段（单支撑）**支撑面只剩一只脚**，此时身体任何横向平移或
       *   转动都会立刻吃掉本来就只有 1.23 倍余量的稳定裕度（实测抬脚后 CoM 离支撑脚
       *   0.171 m，而单脚侧向半宽只有 0.139 m）。
       *   ⇒ 摆动相**冻结**身体（横向 CoM 速度 + 全身角速度），落地之后才允许动。
       *   与文献一致：Perry 八相分期里双支撑（0~10%、50~60%）才是"调整身体"的时间窗
       *   （见 gaitPhase.ts 的三相状态机）。
       */
      stillSwing: 2,
      minCycle: 0.9,
      jointMove: 0.3,
      /** 逐关节倍率（UI 滑块） */
      moveScale: {},
      /**
       * 弯腰驼背罚 ∫(cos tilt − 1)dt。★ 从 0.5 抬到 2.0：这个 rig 被动站不住，
       *   "塌着往前滑"也能拿速度跟踪分（实测零输出基因组滑 0.65 m 拿 velTrack +0.63），
       *   倾角罚必须压过 locomotion 收益，"塌"才不是可行解。
       */
      upright: 2,
      /** 高度偏差罚 */
      height: 0.8,
      survive: 0,
      /** 关节角速度平方罚 */
      jointMotion: 1e-3,
      /** 力矩平方罚 */
      torque: 2e-5,
      /** 电机指令变化率罚（替代旧的 accSmooth；旧版符号写反过一次，"疯狂抽风"反而加分） */
      actRate: 0.25,
      energy: 0.02,
      // ══════ 以下只被 fight 分支用 ══════
      hit: 3,
      hurt: 1,
      approach: 0.8,
      balance: 2,
      fall: 2
    };
    STAND_BOTH_FEET = 1.5;
    ZERO2 = { x: 0, y: 0, z: 0 };
    Sim = class {
      /** ★ 每次 begin() 都会整世界重建（原因见 buildWorld），所以别在外部长期持有 */
      world;
      doll;
      cfg;
      shape;
      /** 本次评估实际使用的权重（= W 叠加 cfg.weights） */
      w;
      // ★ 可运行时调（UI 滑块），见 setWeights
      stages;
      // 每个控制周期包含几个物理步
      ticksTotal;
      // 一次评估的控制周期总数
      /** 物理步长（秒）—— driveMotors 的 dt */
      dt;
      sk;
      // ---- 复用缓冲（零分配） ----
      params;
      x;
      hidden;
      out;
      motor;
      jbuf = new Float64Array(3);
      /** ★ 重心 / 支撑域缓冲（posture.ts，零分配） */
      com = newCom();
      /** ★ 公开给 teacher 的**真实支撑域**（每控制周期由 readSupport 更新）。
       *   平衡门的 MoS 必须用这个 —— 此前 teacher 自己用常数 STANCE_X_HALF 估算，
       *   得出的是假 MoS（实测 −200mm），门因此永闭。 */
      sup = newSupport();
      // ---- 评估状态 ----
      subStep = 0;
      tick = 0;
      phase = 0;
      startX = 0;
      initTorsoY = 0;
      accUpright = 0;
      accHeight = 0;
      accLateral = 0;
      accEnergy = 0;
      // ══════ 走路奖励（walkReward.ts 的 11 项）══════
      accLift = 0;
      // Σ_脚 min(1, 腾空/目标)·dt
      accSingle = 0;
      // 单脚支撑时间积分（×dt）
      gN0 = 0;
      gN1 = 0;
      gN2 = 0;
      // 接地脚数的帧数分布（诊断）
      accRefHip = 0;
      accRefKnee = 0;
      // 参考分的时间积分（身体级：两条腿合起来的形状分）
      /** ★★ 盆骨优先**分腿**积分：左腿的髋先动只进 accPelvisL，右腿只进 accPelvisR。
       *  以前是一个 accPelvis 把两腿平均 ⇒ 调试根本说不清"是左腿没过还是右腿没过"。 */
      accPelvisL = 0;
      accPelvisR = 0;
      pfL = new PelvisFirstTracker();
      pfR = new PelvisFirstTracker();
      ssL = new StepSettleTracker();
      ssR = new StepSettleTracker();
      accSettle = 0;
      accPace = 0;
      accMoS = 0;
      accPlace = 0;
      mosMinSeen = Infinity;
      mosSum = 0;
      mosN = 0;
      settleDebug = "";
      bal = new BalanceJudge();
      lbuf = new Float64Array(3);
      footFar = 0;
      // ★ 脚的最远前伸（"以脚为准"的距离基准）
      footDist = 0;
      // ★ 有效脚距离（只在头没塌时累加）
      torsoDist = 0;
      footVel = 0;
      // 脚的速度（m/s）
      lastFootX = 0;
      footStart = 0;
      imbAcc = 0;
      validTicks = 0;
      stepCycleT = 0;
      /** 诊断：迈步-稳住状态机的末态（为什么没结算） */
      get settleState() {
        return this.settleDebug;
      }
      altCount = 0;
      accSwitchQ = 0;
      // Σ 换脚事件时的 φ(v*−v_x)（推进中的换脚才计价）
      accShift = 0;
      // ∫|载荷左−载荷右|dt（重心转移，0..1/秒）          // ★ 换支撑脚次数（"一次抬一条"的事件计数）
      accTicks = 0;
      // 累计控制秒数（给"平均"类分项做分母）
      accAlive = 0;
      // ∫"站得住"因子 dt（门控抬腿/单脚支撑/要动三项）
      accJtMove = {};
      // 逐关节"要动"
      accMoveSum = 0;
      accJointMotion = 0;
      // ∫Σ|q̇|²
      accTau = 0;
      // ∫Στ²
      accActRate = 0;
      // ∫Σ|Δq*|²
      lastLoadFrac = [0.5, 0.5];
      // 上一拍每脚载荷份额（观测用）
      footTmpL = new Float64Array(3);
      footTmpR = new Float64Array(3);
      hipTmp = new Float64Array(3);
      airL = 0;
      // 左脚连续腾空时间
      airPeakL = 0;
      airPeakR = 0;
      // 本次腾空的最大脚底高度（离地高度判据）
      cycTimes = [];
      // 换支撑脚的时刻（节律门用）
      // ── 顺序步态状态机（迈步 → 调整 → 迈步）+ 它需要的逐拍量 ──
      gp = new GaitPhaseMachine();
      // ★ teacher 也要读当前相（否则脊椎模块的开关是假的）
      /**
       * ★★★ 发令者（用户 2026-10-02："主动发令控制一个模块，其余模块进行调整和平衡的稳定；
       *   发令顺序是腿、腰、腿；但只发令，别精确控制腿部落点"）。
       *   它只说**哪条腿 / 什么时候到腰 / 该走了没有**，绝不给位置目标。
       *   顺序固定：左腿 → 腰 → 右腿 → 腰 → …；`jitter` 提供反应随机性。
       */
      cmd = new GaitCommander();
      /** 伺服层反馈：上一个动作稳住/落地了才发下一条令（由稳定跟踪器更新） */
      servoReady = true;
      /** ★ 连续稳住多久才允许发下一条令（s）——"没稳住就不许迈下一步" */
      settleHold = 0;
      get servoReadyDbg() {
        return this.servoReady;
      }
      /** 发令总数（调试） */
      get cmdOrders() {
        return this.cmd.nOrders;
      }
      /** 调试：发令时间线 */
      get cmdTimeline() {
        return this.cmd.timeline();
      }
      get cmdLabel() {
        return this.cmd.label;
      }
      /**
       * ★★★ 算法模块开关（用户 2026-10-02："左腿就是左腿，右腿就是右腿，脊椎就是脊椎；
       *   需要代码操控什么时候什么模块起作用，什么不起作用"）。
       *   所有奖励项的"何时生效"门控**统一**走这里，不再各写各的 `if (nGround === 1)`。
       *   调试看 `mod.report(gp.now, nGround)`。
       */
      mod = new ModuleSet();
      accStill = 0;
      // ★ 摆动相里身体的运动量（要被罚）
      stillStep = 0;
      stillAdjust = 0;
      // 诊断：摆动段 vs 调整段的身体运动量
      /** ★ 调试用的当前状态："该迈哪条腿 + 身体该不该动" */
      gpLabel = "both \u8FC7\u6E21\uFF08\u53CC\u811A\u7740\u5730\uFF09";
      gpSwing = null;
      gpBodyFree = false;
      /** 状态机转移轨迹（含"哪个状态没通过"） */
      get stateTrace() {
        return this.gp.trace;
      }
      accCycle = 0;
      gpPaidThisStep = false;
      cycleN = 0;
      cycleFlick = 0;
      cycleAdj = 0;
      cyclePhase = "both";
      lastMosX = 0;
      lastSupEdgeX = 0;
      lastRefHip = 0;
      lastRefKnee = 0;
      flickerCount = 0;
      // 被判定为接触抖动（离地不够）的次数（诊断）
      lastAltT = 0;
      airR = 0;
      motorPrev;
      // 上一拍的马达目标（action rate）
      accVelTrack = 0;
      // ∫(φ(v*−vx) − φ(v*))dt  （扣基线，站桩 = 0）
      accYaw = 0;
      // ∫φ(−ω_y)dt
      accLat = 0;
      // ∫v_z² dt
      accTilt = 0;
      // ∫|ω|² dt
      accVel = 0;
      accClose = 0;
      /** ★ DCM 越界积分（无量纲，见 W.balance） */
      accBalance = 0;
      // ---- 战斗模式 ----
      puppet;
      fist;
      fistBaseX = 0;
      fistLunge = 0.72;
      fistY = 1.05;
      handCooldownL = 0;
      handCooldownR = 0;
      /** 上一控制周期拳头是否压在躯干上 —— 用于把"被击中"按出拳次数计，而不是按周期数 */
      fistTouching = false;
      // ---- 对外诊断 ----
      finished = true;
      fallen = false;
      fitness = 0;
      hits = 0;
      hurts = 0;
      /** ★ 诊断：DCM 归一化越界量的峰值（1 = 越出整整一个被动半宽） */
      peakDcmX = 0;
      peakDcmZ = 0;
      /** ★★ 诊断：本回合**因何中止**。'' = 跑满时长没摔。
       *
       * 为什么必须有（跑 probe-posture 时踩出来的真需求）：
       *   摔倒判定有三条独立路径（胸塌到 62% / 倾角 > 1.25 rad / 头 < 0.45 m），
       *   而"ξz 峰值只有 1.25（远没越界）却仍然判摔"这种情况**无法从分数和 ξ 看出来**。
       *   没有归因就只能瞎猜是"倒"还是"蹲塌"，而这两者对应的修法完全相反
       *   （倒 ⇒ 补侧向控制；蹲塌 ⇒ 看动作空间/阈值）。
       *   取值 = 三条里**超标最狠**的那一条，比按 || 短路顺序取更利于诊断。
       */
      fallReason = "";
      /** ★ 摔倒瞬间的判据快照（用户 2026-10-02：看到底是什么触发摔倒） */
      fallDiag = { rH: 0, rT: 0, rD: 0, torsoY: 0, headY: 0, tiltDeg: 0, hit: "" };
      /** ★ 诊断：中止瞬间的姿态（跑满时长 = 结束瞬间），用于区分"倒"与"蹲塌" */
      endTorsoY = 0;
      endTilt = 0;
      endHeadY = 0;
      /** ★ 诊断：ξ 同时落在 x/z 域内的控制周期占比（"站住了"的直接指标） */
      inDomainRatio = 0;
      /** 支撑域内占比（诊断：域内 CoM 占比，DCM 判据已从走路奖励里去掉） */
      supInRatio = 0;
      supTicks = 0;
      inDomainTicks = 0;
      balanceTicks = 0;
      constructor(sk2, shape = BRAIN_SHAPE, cfg = DEFAULT_SIM) {
        const n = sk2.joints.length;
        const expIn = 36 + 6 * n, expOut = 3 * n;
        if (shape.inputs !== expIn || shape.outputs !== expOut) {
          throw new Error(
            `[sim] \u7F51\u7EDC\u5F62\u72B6\u4E0E\u9AA8\u67B6\u4E0D\u7B26\uFF1Ashape ${shape.inputs}\u2192${shape.outputs}\uFF0C\u4F46\u9AA8\u67B6 ${n} \u5173\u8282\u8981\u6C42 ${expIn}\u2192${expOut}\u3002\u8BF7\u4F20 shapeForJoints(sk.joints.length)\uFF08BRAIN_SHAPE \u662F 9 \u5173\u8282\u7684\u9ED8\u8BA4\u503C\uFF0C\u4E0D\u80FD\u7528\u4E8E\u672C rig\uFF09\u3002`
          );
        }
        this.sk = sk2;
        this.cfg = cfg;
        this.shape = shape;
        this.w = { ...W, ...cfg.weights };
        this.dt = 1 / cfg.physicsHz;
        this.stages = Math.max(1, Math.round(cfg.physicsHz / cfg.controlHz));
        this.ticksTotal = Math.max(1, Math.round(cfg.duration * cfg.controlHz));
        this.buildWorld();
        this.params = new Float32Array(brainParamCount(shape));
        this.x = new Float32Array(shape.inputs);
        this.hidden = new Float32Array(shape.hidden);
        this.out = new Float32Array(shape.outputs);
        this.motor = new Float32Array(this.doll.jointCount * 3);
        this.motorPrev = new Float32Array(this.doll.jointCount * 3);
        for (const k of MOVE_JOINTS) this.accJtMove[k] = 0;
        this.initTorsoY = this.doll.torso().translation().y;
      }
      /**
       * ★★ 重建整个物理世界（重力/步长/求解器设置 + 地面 + 12 刚体 + 9 关节 + 战斗道具）。
       *
       * 为什么每个个体每次评估都要重建（这是个**必须**，不是洁癖）：
       *   Rapier 的解算器把上一轮的**累积冲量**留在缓存里做暖启动 —— 关节约束一份、
       *   地面接触一份。只把刚体的位姿/速度 reset 掉清不掉它。
       *   probe-reset / verify-core D 段实测：同一份基因组、同一个 World 连续重放两次，
       *   **从第 1 步就开始分叉**（不是第 2 步之后 ⇒ 不是混沌敏感性），偏差 2.55e-3 m；
       *   而且"删关节再重建"（Ragdoll.purgeJointCache）清不掉那 2.55e-3 ——
       *   说明剩下的是**地面接触**的缓存。⇒ 只能整世界重建。
       *   不修的话，ES 的适应度里混着"上一轮跑到哪"的固定偏置，个体之间不可比。
       *
       * 开销实测：12 刚体 + 14 collider + 9 关节的世界重建 ≈ 0.2 ms，
       *   相对一次评估（4s × 120Hz = 480 步 × ~0.2 ms/步 ≈ 96 ms）不到 0.3%。
       */
      buildWorld() {
        if (this.world) this.world.free();
        const w = new rapier_default.World({ x: 0, y: -9.81, z: 0 });
        w.timestep = this.dt;
        w.numSolverIterations = this.cfg.solverIterations;
        w.numAdditionalFrictionIterations = Math.max(1, this.cfg.solverIterations >> 1);
        if (this.cfg.contactHz > 0) {
          const ip = w.integrationParameters;
          ip.contact_natural_frequency = this.cfg.contactHz;
          const dr = ip;
          if ("contact_damping_ratio" in dr) dr.contact_damping_ratio = this.cfg.contactDamping;
        }
        this.world = w;
        this.doll = new Ragdoll(w, this.sk, this.cfg.doll);
        this.puppet = void 0;
        this.fist = void 0;
        if (this.cfg.mode === "fight") this.createPuppet();
      }
      /**
       * 战斗模式：一个固定假人 + 一根会周期性朝你捅过来的拳头（kinematic，不受物理反作用）。
       *
       * ★★ 假人的距离是**实测**定出来的，不是拍脑袋（tools/probe-fight 的逐帧数据）：
       *    - 手（前臂刚体的几何中心）从静止位置向前挥到底，最远只能到 x ≈ 0.26
       *      （肩的屈伸限位 +80°，肘只能到 +10°，而且前臂 bbox 中心本来就偏外侧 z≈±0.34）。
       *    - 原来假人放在 x=1.0，最近手距 0.79m > 判定阈值 0.68 ⇒ **永远打不中**，
       *      等价于"必须先学会走路再谈打人"，战斗阶段因此完全无法独立学习。
       *    - 现在放 x=0.72：手挥到底时距离 ≈ 0.50m < 0.68 ✅，一站定就能练挥拳。
       *    - 拳头同理：拳根 0.58、推出 0.42 ⇒ 最远 x=0.16，刚好够到躯干胶囊表面
       *      （躯干半径 0.136 + 拳半径 0.09 = 0.226），既真接触又不会穿过身体把人顶飞。
       */
      createPuppet() {
        const x = 0.72;
        const bodyDesc = rapier_default.RigidBodyDesc.fixed().setTranslation(x, 0.95, 0);
        this.puppet = this.world.createRigidBody(bodyDesc);
        this.world.createCollider(
          rapier_default.ColliderDesc.cuboid(0.16, 0.42, 0.12).setFriction(0.8),
          this.puppet
        );
        this.fistBaseX = x - 0.14;
        this.fistLunge = 0.42;
        this.fistY = 1.05;
        const fistDesc = rapier_default.RigidBodyDesc.kinematicPositionBased().setTranslation(this.fistBaseX, this.fistY, 0);
        this.fist = this.world.createRigidBody(fistDesc);
        this.world.createCollider(rapier_default.ColliderDesc.ball(0.09), this.fist);
      }
      get ticksDone() {
        return this.tick;
      }
      get progress() {
        return this.tick / this.ticksTotal;
      }
      /** ★ 净前进距离（跑到此刻为止的位移；"最远距离"已弃用，见 W 的注释） */
      /**
       * ★★ 距离改为**以脚为准**（用户 2026-10-02："移动距离应该以脚的移动为准"）。
       * 原来用的是躯干 x —— 于是"整个人往前扑倒"会被算成"走了很远"，
       * 策略只要向前扑就能拿满速度分（实测零输出基线都能量到 0.65 m）。
       * 真正的判据是"支撑面（脚）在前进"：Hof 的说法是，走路是**支撑面前进**，
       * 不是质心前进；质心冲出支撑面而脚没跟上，那就是**摔**。
       * ★ 而且只在**头没塌**（`valid`）时累加：身体已经塌下去时往前扑**一分不给**。
       */
      get distance() {
        return this.footDist;
      }
      /** 诊断：躯干位移（用来对比"脚走了多少 vs 人扑了多远"） */
      get torsoDistance() {
        return this.torsoDist;
      }
      /** 诊断：脚的速度（m/s） */
      get footSpeed() {
        return this.footVel;
      }
      /** 诊断：头的世界高度 */
      headTopY() {
        let y = -1e9;
        for (const b of this.doll.bodies) {
          const t = b.translation();
          if (t.y > y) y = t.y;
        }
        return y + 0.1;
      }
      /** 两只脚的最远前伸（x） */
      footMaxX() {
        return Math.max(this.footTmpL[0], this.footTmpR[0]);
      }
      /** 诊断：本回合的电机指令变化率积分（替代旧的抖动积分 Σ(Δτ)²，见 W.actRate） */
      get actionRateCost() {
        return this.accActRate;
      }
      // ------------------------------------------------------------ 生命周期
      /** ★ UI 滑块：运行时改权重（只接受新配方那 11 项的键） */
      setWeights(w) {
        this.w = { ...this.w, ...w };
      }
      /** 装上一份基因组，重置世界，开始一次评估 */
      begin(params) {
        if (params.length !== this.params.length) {
          throw new Error(`[sim] \u57FA\u56E0\u7EC4\u957F\u5EA6 ${params.length} \u2260 \u671F\u671B ${this.params.length}`);
        }
        this.params = params;
        this.buildWorld();
        this.doll.reset(0);
        this.startX = this.doll.torso().translation().x;
        this.initTorsoY = this.doll.torso().translation().y;
        this.bal.setRefHead(this.headTopY());
        this.doll.soleXZ("l", this.footTmpL);
        this.doll.soleXZ("r", this.footTmpR);
        this.lastFootX = this.footMaxX();
        this.footFar = this.lastFootX;
        this.footStart = this.lastFootX;
        this.subStep = 0;
        this.tick = 0;
        this.phase = 0;
        this.accUpright = 0;
        this.accHeight = 0;
        this.accLateral = 0;
        this.accEnergy = 0;
        this.accVel = 0;
        this.accClose = 0;
        this.accBalance = 0;
        this.gN0 = 0;
        this.gN1 = 0;
        this.gN2 = 0;
        this.accRefHip = 0;
        this.accRefKnee = 0;
        this.accPelvisL = 0;
        this.accPelvisR = 0;
        this.pfL.reset();
        this.pfR.reset();
        this.ssL.reset();
        this.ssR.reset();
        this.accSettle = 0;
        this.accPace = 0;
        this.accMoS = 0;
        this.accPlace = 0;
        this.bal.reset();
        this.footFar = 0;
        this.footDist = 0;
        this.torsoDist = 0;
        this.footVel = 0;
        this.lastFootX = 0;
        this.imbAcc = 0;
        this.validTicks = 0;
        this.stepCycleT = 0;
        this.mosMinSeen = Infinity;
        this.mosSum = 0;
        this.mosN = 0;
        this.accLift = 0;
        this.accSingle = 0;
        this.accTicks = 0;
        this.accMoveSum = 0;
        this.accAlive = 0;
        this.altCount = 0;
        this.accShift = 0;
        this.accSwitchQ = 0;
        this.doll.resetAlt();
        this.accJointMotion = 0;
        this.accTau = 0;
        this.accActRate = 0;
        this.airL = 0;
        this.airR = 0;
        this.motorPrev.fill(0);
        this.airPeakL = 0;
        this.airPeakR = 0;
        this.cycTimes = [];
        this.lastAltT = 0;
        this.lastLoadFrac = [0.5, 0.5];
        this.gp.reset();
        this.accCycle = 0;
        this.gpPaidThisStep = false;
        this.accStill = 0;
        this.stillStep = 0;
        this.stillAdjust = 0;
        this.mod.reset();
        this.cycleN = 0;
        this.cycleFlick = 0;
        this.cycleAdj = 0;
        this.cyclePhase = "both";
        this.lastMosX = 0;
        this.lastSupEdgeX = 0;
        this.lastRefHip = 0;
        this.lastRefKnee = 0;
        this.accVelTrack = 0;
        this.accYaw = 0;
        this.accLat = 0;
        this.accTilt = 0;
        for (const k of MOVE_JOINTS) this.accJtMove[k] = 0;
        this.supInRatio = 0;
        this.supTicks = 0;
        this.inDomainTicks = 0;
        this.balanceTicks = 0;
        this.peakDcmX = 0;
        this.peakDcmZ = 0;
        this.endTorsoY = 0;
        this.endTilt = 0;
        this.endHeadY = 0;
        this.inDomainRatio = 0;
        this.handCooldownL = 0;
        this.handCooldownR = 0;
        this.fistTouching = false;
        this.finished = false;
        this.fallen = false;
        this.fitness = 0;
        this.hits = 0;
        this.hurts = 0;
        if (this.fist) this.fist.setNextKinematicTranslation({ x: this.fistBaseX, y: this.fistY, z: 0 });
      }
      /**
       * 推进最多 budgetSteps 个物理步，返回实际消耗的步数。
       * 评估跑完（或摔倒）即提前返回。
       */
      advance(budgetSteps) {
        if (this.finished) return 0;
        let used = 0;
        while (used < budgetSteps && !this.finished) {
          if (this.subStep === 0) this.controlTick();
          this.doll.driveMotors(this.dt);
          this.world.step();
          this.doll.enforceLimits();
          if (this.doll.supportPointOn) this.doll.applySupportPoint(this.dt);
          used++;
          this.subStep++;
          if (this.subStep >= this.stages) {
            this.subStep = 0;
            this.tick++;
            if (this.tick >= this.ticksTotal) {
              this.finish(false);
              break;
            }
          }
          if (this.checkFall()) break;
        }
        return used;
      }
      /**
       * ★★ 运行时调奖励规则（UI 滑块/开关用，用户 2026-10-01："做成可调的按钮"）：
       *   · `straight=false` ⇒ 取消"这一脚必须直线"（`stepMaxDz` 放到无穷大），
       *     只保留换脚奖励与位移门槛；
       *   · `minDx` ⇒ 改"一次有效迈步所需的净前进"（0 = 不设门槛）。
       *   换脚奖励本身（W.switch）**不受这里影响**，它必须一直在。
       */
      /**
       * ★ 诊断（走路奖励）：腾空/单脚支撑/逐关节移动 —— 经典配方里"交替步态从哪来"的全部证据。
       *   `singleRatio` = 恰好一脚着地的时间占比（"一次抬一条"的直接度量）。
       */
      /** ★ 调试：接触/腾空的原始计数（一脚着地=0、双脚=1、离地=2 的帧数），用来定位"为什么换脚数是 0" */
      get rawGround() {
        return { n0: this.gN0, n1: this.gN1, n2: this.gN2, accSingle: this.accSingle, accLift: this.accLift, switchQ: this.accSwitchQ, alive: this.accTicks > 0 ? this.accAlive / this.accTicks : 0 };
      }
      get walkStat() {
        const E = Math.max(0.2, this.accTicks);
        const jt = {};
        for (const k of MOVE_JOINTS) jt[k] = (this.accJtMove[k] ?? 0) / E;
        return {
          airL: this.airL,
          airR: this.airR,
          singleRatio: this.accSingle / E,
          moveFrac: this.accMoveSum / E / MOVE_JOINTS.length,
          jtMove: jt,
          supInRatio: this.supTicks > 0 ? this.supInRatio / this.supTicks : 0,
          inDomainRatio: this.balanceTicks > 0 ? this.inDomainTicks / this.balanceTicks : 0
        };
      }
      /** ★ 诊断：当前观测里的时钟两项（clock.sin, clock.cos）与步态相位。 */
      get clock() {
        const c2 = Math.PI * 2;
        return { phase: this.phase, sin: this.x[0], cos: this.x[1] };
      }
      /** 一次性跑完（离屏验收 / 无渲染时用） */
      runToEnd() {
        while (!this.finished) this.advance(1 << 30);
        return this.fitness;
      }
      // ------------------------------------------------------------ 每控制周期
      /**
       * 最近一帧的观测向量（`x`）。给行为克隆/探针用：teacher 采数据时要记下
       * "这一刻看到了什么"，才能训出 `观测 → 目标` 的映射。
       */
      observation() {
        return this.x;
      }
      controlTick() {
        const doll = this.doll;
        const p = this.params;
        this.phase += this.cfg.gaitHz / this.cfg.controlHz;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);
        const torso = doll.torso();
        const tp = torso.translation();
        const tv = torso.linvel();
        const tw = torso.angvel();
        const tq = torso.rotation();
        const x = this.x;
        const c2 = Math.PI * 2;
        x[0] = Math.sin(this.phase * c2);
        x[1] = Math.cos(this.phase * c2);
        if (this.cfg.obsMask?.clock) {
          x[0] = 0;
          x[1] = 0;
        }
        x[2] = tq.x;
        x[3] = tq.y;
        x[4] = tq.z;
        x[5] = tq.w;
        x[6] = tv.x * 0.5;
        x[7] = tv.y * 0.5;
        x[8] = tv.z * 0.5;
        x[9] = tw.x * 0.2;
        x[10] = tw.y * 0.2;
        x[11] = tw.z * 0.2;
        x[12] = tp.y;
        x[13] = tp.z;
        const com = readCom(doll, this.com);
        const sup = readSupport(doll, this.sup);
        const om = omegaAt(com.y);
        const nx = (dcm(com.x, com.vx, om) - sup.cx) / sup.halfX;
        const nz = (dcm(com.z, com.vz, om) - sup.cz) / sup.halfZ;
        x[14] = com.x - sup.cx;
        x[15] = com.z - sup.cz;
        x[16] = com.vx * 2;
        x[17] = com.vz * 2;
        x[18] = nx > 3 ? 3 : nx < -3 ? -3 : nx;
        x[19] = nz > 3 ? 3 : nz < -3 ? -3 : nz;
        let k = 20;
        const jb = this.jbuf;
        const noJoint = this.cfg.obsMask?.joint === true;
        const noQuat = this.cfg.obsMask?.quat === true;
        const noVel = this.cfg.obsMask?.vel === true;
        for (let i = 0; i < doll.jointCount; i++) {
          doll.jointRot(i, jb);
          if (noJoint) {
            x[k] = 0;
            x[k + 1] = 0;
            x[k + 2] = 0;
            k += 3;
          } else {
            x[k++] = jb[0];
            x[k++] = jb[1];
            x[k++] = jb[2];
          }
        }
        for (let i = 0; i < doll.jointCount; i++) {
          doll.jointRelVel(i, jb);
          if (noJoint) {
            x[k] = 0;
            x[k + 1] = 0;
            x[k + 2] = 0;
            k += 3;
          } else {
            x[k++] = jb[0] * 0.2;
            x[k++] = jb[1] * 0.2;
            x[k++] = jb[2] * 0.2;
          }
        }
        if (noQuat) {
          for (let q = 2; q <= 5; q++) x[q] = 0;
        }
        if (noVel) {
          for (let q = 6; q <= 11; q++) x[q] = 0;
        }
        x[k] = doll.soleY("l");
        x[k + 1] = doll.soleY("r");
        const lf = this.lastLoadFrac;
        x[k + 2] = Math.round(lf[0] * 100) / 100;
        x[k + 3] = Math.round(lf[1] * 100) / 100;
        {
          const duty = Math.max(0.15, Math.min(0.85, this.cfg.swingDuty));
          const ph = this.phase >= 1 ? this.phase - 1 : this.phase;
          const w1 = (q) => {
            if (ph >= q || ph < q - 1 + duty) return 0;
            const s = (ph - (q - 1 + duty) + 1) / duty;
            return Math.sin(Math.PI * Math.max(0, Math.min(1, s)));
          };
          x[k + 4] = w1(0);
          x[k + 5] = w1(duty);
        }
        doll.soleXZ("l", this.footTmpL);
        doll.soleXZ("r", this.footTmpR);
        const q1 = (v) => Math.round(v * 1e3) / 1e3;
        x[k + 6] = q1(this.footTmpL[0] - com.x);
        x[k + 7] = q1(this.footTmpR[0] - com.x);
        x[k + 8] = q1(this.footTmpL[2] - com.z);
        x[k + 9] = q1(this.footTmpR[2] - com.z);
        for (let s2 = 0; s2 < 2; s2++) {
          const side = s2 === 0 ? "l" : "r";
          const fp = s2 === 0 ? this.footTmpL : this.footTmpR;
          doll.hipPoint(side, this.hipTmp);
          const dx = q1(fp[0] - this.hipTmp[0]);
          const dy = q1(fp[1] - this.hipTmp[1]);
          x[k + 10 + s2 * 3] = dx;
          x[k + 11 + s2 * 3] = dy;
          x[k + 12 + s2 * 3] = q1(Math.hypot(dx, dy));
        }
        if (this.cfg.driver === "controller") return;
        brainForward(this.shape, p, x, this.hidden, this.out);
        for (let i = 0; i < this.motor.length; i++) this.motor[i] = this.out[i];
        doll.setMotorTargets(this.motor);
        const dt = 1 / this.cfg.controlHz;
        this.accVel += tv.x * dt;
        this.accUpright += Math.cos(doll.tiltOf(torso)) * dt;
        this.accHeight += Math.abs(tp.y - this.initTorsoY) * dt;
        this.accLateral += Math.abs(tp.z) * dt;
        const eX = dcmExcess(nx, 0, 1);
        const eZ = dcmExcess(nz, 0, 1);
        if (this.cfg.mode === "fight") this.accBalance += (eX * eX + eZ * eZ) * dt;
        if (eX === 0 && eZ === 0) this.inDomainTicks++;
        this.balanceTicks++;
        const gL = footGrounded(doll, "l"), gR = footGrounded(doll, "r");
        const nGround = (gL ? 1 : 0) + (gR ? 1 : 0);
        if (nGround === 0) this.gN0++;
        else if (nGround === 1) this.gN1++;
        else this.gN2++;
        const stanceNow = nGround === 0 ? 0 : gL ? 1 : 2;
        const altNow = nGround === 1 && this.doll.altEvent(stanceNow, dt);
        if (altNow) this.altCount++;
        this.airL = gL ? 0 : this.airL + dt;
        this.airR = gR ? 0 : this.airR + dt;
        if (gL) this.airPeakL = 0;
        else this.airPeakL = Math.max(this.airPeakL, this.doll.soleY("l"));
        if (gR) this.airPeakR = 0;
        else this.airPeakR = Math.max(this.airPeakR, this.doll.soleY("r"));
        const air = Math.min(1, this.airL / AIR_TARGET) + Math.min(1, this.airR / AIR_TARGET);
        const clL = this.airPeakL >= MIN_CLEARANCE, clR = this.airPeakR >= MIN_CLEARANCE;
        const cl = nGround === 1 ? gL ? clR : clL : nGround === 0 ? clL && clR : false;
        this.accLift += air * (nGround === 1 ? 1 : nGround === 0 ? 0.5 : 0) * (cl ? 1 : 0.15) * dt;
        const hRatio = tp.y / Math.max(0.2, this.initTorsoY);
        const alive = Math.max(0, Math.min(1, (hRatio - 0.6) / 0.2));
        this.accAlive += alive * dt;
        const [fl2, fr2] = this.doll.footLoadFrac(dt);
        this.lastLoadFrac = [fl2, fr2];
        if (this.mod.active("loadShift", this.gp.now, nGround, null)) this.accShift += Math.abs(fl2 - fr2) * dt;
        const dom = fl2 > 0.7 ? 1 : fr2 > 0.7 ? 2 : 0;
        const domGround = dom === 1 ? gL : dom === 2 ? gR : false;
        const otherGround = dom === 1 ? gR : dom === 2 ? gL : true;
        if (dom !== 0 && domGround && !otherGround && this.doll.altEvent(dom, dt)) {
          const airPeak = dom === 1 ? this.airPeakR : this.airPeakL;
          if (airPeak < MIN_CLEARANCE) {
            this.flickerCount++;
          } else {
            this.altCount++;
            const tNow = this.tick / this.cfg.controlHz;
            if (this.lastAltT > 0) this.cycTimes.push(tNow - this.lastAltT);
            this.lastAltT = tNow;
            this.accSwitchQ += phi(TARGET_VX - this.footVel);
          }
        }
        if (this.mod.active("singleSupport", this.gp.now, nGround, null))
          this.accSingle += (nGround === 1 ? 1 : 0) * (cl ? 1 : 0.1) * dt;
        if (nGround === 0) this.accSingle += -0.5 * (cl ? 1 : 0.1) * dt;
        if (this.cfg.mode === "stand" && nGround === 2) {
          this.accSingle += -STAND_BOTH_FEET * (cl ? 1 : 0.1) * dt;
        }
        {
          const clr = Math.max(this.airPeakL, this.airPeakR);
          const mosHere = this.lastMosX;
          const xiH = this.lastSupEdgeX - mosHere;
          const footHere = gL ? this.footTmpR[0] : this.footTmpL[0];
          const eH = Math.abs(footHere - xiH);
          const placeHere = eH <= 0.05 ? 1 : Math.max(0, 1 - (eH - 0.05) / 0.25);
          const shpHere = (this.lastRefHip + this.lastRefKnee) * 0.5;
          const pelHere = (this.pfL.score() + this.pfR.score()) * 0.5;
          const swingLeg = orderLeg(this.cmd.now) ?? (gL ? "r" : "l");
          this.gp.step(nGround, clr, mosHere, shpHere, placeHere, pelHere, dt, swingLeg);
          this.gpLabel = this.gp.label;
          this.gpSwing = this.gp.swingLeg;
          this.gpBodyFree = this.gp.bodyFree;
          this.cmd.step(dt, this.servoReady);
          const stillOn = this.mod.active("stillSwing", this.gp.now, nGround, null);
          const wb = Math.hypot(this.lbuf[0], this.lbuf[1], this.lbuf[2]);
          const bodyMove = Math.abs(this.com.vz) + Math.abs(this.com.vx) * 0.3 + wb * 0.08;
          if (nGround === 1) {
            if (stillOn) {
              this.accStill += bodyMove * dt;
              this.stillStep += bodyMove * dt;
            } else if (this.gp.bodyFree) this.stillAdjust += bodyMove * dt;
          }
          const cyc = this.gp.tally;
          if (cyc.lastCredit > 0 && !this.gpPaidThisStep) {
            this.accCycle += cyc.lastCredit;
            this.gpPaidThisStep = true;
          }
          if (!this.gp.inAdjust) this.gpPaidThisStep = false;
          this.cycleN = cyc.nAdjustOk;
          this.cycleFlick = cyc.flickers;
          this.cycleAdj = cyc.meanAdjustSec;
          this.cyclePhase = this.gp.now;
        }
        if (this.mod.active("pelvisFirst", this.gp.now, nGround, "l") || this.mod.active("pelvisFirst", this.gp.now, nGround, "r")) {
          if (nGround === 1) {
            const ph = this.phase >= 1 ? this.phase - 1 : this.phase;
            const swingIsL = gL;
            const tSw = swingIsL ? ph + STANCE_FRAC : ph;
            const rd = (name) => {
              const i = JOINT_ORDER.indexOf(name);
              if (i < 0) return 0;
              return doll.jointAngle(i) + (this.sk.joints[i]?.restRad[2] ?? 0);
            };
            const hipSw = rd(swingIsL ? "hip_l" : "hip_r"), kneeSw = rd(swingIsL ? "knee_l" : "knee_r");
            const hipSt = rd(swingIsL ? "hip_r" : "hip_l"), kneeSt = rd(swingIsL ? "knee_r" : "knee_l");
            const a = scoreLeg(tSw, hipSw, kneeSw);
            const b = scoreLeg((tSw + 0.5) % 1, hipSt, kneeSt);
            this.accRefHip += (a.hip + b.hip) * 0.5 * dt;
            this.accRefKnee += (a.knee + b.knee) * 0.5 * dt;
          }
          {
            const dt2 = dt;
            const vel = (name) => {
              const i = JOINT_ORDER.indexOf(name);
              if (i < 0) return 0;
              doll.jointRelVel(i, this.jbuf);
              return this.jbuf[2];
            };
            const ph2 = this.phase >= 1 ? this.phase - 1 : this.phase;
            this.pfL.step(vel("hip_l"), vel("knee_l"), gL, dt2);
            this.pfR.step(vel("hip_r"), vel("knee_r"), gR, dt2);
            if (this.mod.active("pelvisFirst", this.gp.now, nGround, "l"))
              this.accPelvisL += this.pfL.score() * dt;
            if (this.mod.active("pelvisFirst", this.gp.now, nGround, "r"))
              this.accPelvisR += this.pfR.score() * dt;
          }
        }
        {
          doll.soleXZ("l", this.footTmpL);
          doll.soleXZ("r", this.footTmpR);
          const comB = readCom(doll, this.com);
          wholeBodyAngularMomentum(doll, comB, this.lbuf);
          const headY = this.headTopY();
          const brot = torso.rotation();
          const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (brot.w * brot.x + brot.y * brot.z))));
          const supB = readSupport(doll, this.sup);
          const mosB = marginOfStability(
            comB.x,
            comB.vx,
            omegaAt(comB.y),
            supB.cx + supB.halfX,
            comB.z,
            comB.vz,
            supB.cz + supB.halfZ
          );
          const b = this.bal.step(this.lbuf, headY, dt, pitch, mosB.x);
          const fx = this.footMaxX();
          if (fx > this.footFar) this.footFar = fx;
          this.footVel += ((fx - this.lastFootX) / Math.max(1e-6, dt) - this.footVel) * 0.3;
          this.lastFootX = fx;
          this.torsoDist = doll.torso().translation().x - this.startX;
          if (b.valid) {
            this.footDist = fx - this.footStart;
            this.validTicks += dt;
            this.stepCycleT += dt;
          } else {
            this.imbAcc += 0.5 * dt;
          }
        }
        {
          const com2 = readCom(doll, this.com);
          const sup2 = readSupport(doll, this.sup);
          const om2 = omegaAt(com2.y);
          const mos = marginOfStability(
            com2.x,
            com2.vx,
            om2,
            sup2.cx + sup2.halfX,
            com2.z,
            com2.vz,
            sup2.cz + sup2.halfZ
          );
          if (nGround >= 1) {
            this.mosMinSeen = Math.min(this.mosMinSeen, mos.x);
            this.mosSum += mos.x;
            this.mosN++;
          }
          const fXl = this.footTmpL[0], fXr = this.footTmpR[0];
          const gL2 = this.ssL.step(gL, mos.x, dt, fXl);
          const gR2 = this.ssR.step(gR, mos.x, dt, fXr);
          if (this.mod.active("balance", this.gp.now, nGround, null))
            this.accMoS += mosBand(mos.x) * (nGround === 1 ? 1 : 0) * dt;
          const stableNow = nGround >= 2 && mos.x > 0.02;
          if (stableNow) this.settleHold += dt;
          else this.settleHold = 0;
          this.servoReady = this.settleHold >= SETTLE_HOLD;
          if (nGround === 1) {
            const xi = sup2.cx + sup2.halfX - mos.x;
            const footX = gL ? this.footTmpR[0] : this.footTmpL[0];
            const err = Math.abs(footX - xi);
            this.accPlace += (err <= 0.05 ? 1 : Math.max(0, 1 - (err - 0.05) / 0.25)) * dt;
          }
          if (gL2 < 0 || gR2 < 0) this.accPace += Math.min(gL2, gR2) * dt;
        }
        this.accTicks += dt;
        let jSpd = 0, jMove = 0;
        for (let i2 = 0; i2 < doll.jointCount; i2++) {
          doll.jointRelVel(i2, this.jbuf);
          const w0 = this.jbuf[0], w1 = this.jbuf[1], w2 = this.jbuf[2];
          jSpd += w0 * w0 + w1 * w1 + w2 * w2;
          if (MOVE_SET.has(JOINT_ORDER[i2])) {
            const sp = Math.sqrt(jSpd === 0 ? w0 * w0 : w0 * w0 + w1 * w1 + w2 * w2);
            const f = Math.min(1, sp / JOINT_MOVE_TARGET);
            if (nGround === 1) this.accJtMove[JOINT_ORDER[i2]] += f * dt;
            jMove += f;
          }
        }
        let act2 = 0, tau2 = 0;
        for (let i2 = 0; i2 < this.motor.length; i2++) {
          const dq = this.motor[i2] - this.motorPrev[i2];
          act2 += dq * dq;
          this.motorPrev[i2] = this.motor[i2];
          const tq2 = this.doll.motorImpulse[i2] / this.dt;
          tau2 += tq2 * tq2;
        }
        this.accJointMotion += jSpd * dt;
        this.accActRate += act2 * dt;
        this.accTau += tau2 * dt;
        this.accMoveSum += (nGround === 1 ? jMove : 0) * dt;
        const tvx = this.footVel, tvz = tv.z;
        const ang = torso.angvel();
        this.accVelTrack += (phi(TARGET_VX - tvx) - phi(TARGET_VX)) * dt;
        this.accYaw += phi(-ang.y) * dt;
        this.accLat += tvz * tvz * dt;
        this.accTilt += (ang.x * ang.x + ang.y * ang.y + ang.z * ang.z) * dt;
        if (this.cfg.mode === "fight") this.fightTick(dt);
      }
      /** 战斗模式的额外逻辑：假人出拳节奏 + 命中/受击判定 */
      fightTick(dt) {
        const doll = this.doll;
        const fist = this.fist;
        if (!fist || !this.puppet) return;
        const t = this.tick / this.cfg.controlHz;
        const period = 1.6;
        const ph = t % period / period;
        const pulse = Math.max(0, Math.sin(Math.PI * ph));
        const lunge = pulse * pulse;
        const rp = doll.root().translation();
        const cp = doll.torso().translation();
        const bodyX = (rp.x + cp.x) / 2;
        const bodyY = Math.max(0.45, (rp.y + cp.y) / 2);
        const bodyZ = (rp.z + cp.z) / 2;
        fist.setNextKinematicTranslation({
          x: this.fistBaseX - lunge * this.fistLunge,
          y: bodyY + 0.05,
          z: 0
        });
        const fp = fist.translation();
        const dxf = fp.x - bodyX;
        const dyf = fp.y - bodyY;
        const dzf = fp.z - bodyZ;
        const touching = dxf * dxf + dyf * dyf + dzf * dzf < 0.45 * 0.45;
        if (touching && !this.fistTouching) this.hurts++;
        this.fistTouching = touching;
        const pp = this.puppet.translation();
        this.handCooldownL -= dt;
        this.handCooldownR -= dt;
        let nearest = Infinity;
        const checkHand = (key, cd) => {
          const idx = doll.indexByKey.get(key);
          if (idx === void 0) return cd;
          const hb = doll.bodies[idx];
          const hp = hb.translation();
          const dx = hp.x - pp.x;
          const dy = hp.y - pp.y;
          const dz = hp.z - pp.z;
          const far = dx * dx + dy * dy + dz * dz;
          const d = Math.sqrt(far);
          if (d < nearest) nearest = d;
          const v = hb.linvel();
          const speed = Math.hypot(v.x, v.y, v.z);
          if (cd <= 0 && far < 0.68 * 0.68 && speed > 1) {
            this.hits++;
            return 0.3;
          }
          return cd;
        };
        this.handCooldownL = checkHand("hand_l", this.handCooldownL);
        this.handCooldownR = checkHand("hand_r", this.handCooldownR);
        if (Number.isFinite(nearest)) {
          this.accClose += Math.max(0, 1 - nearest / 1.2) * dt;
        }
      }
      /** 摔倒判定：躯干塌下去 / 倾角太大 / 头贴地 → 提前结束 */
      checkFall() {
        if (this.finished) return true;
        const torso = this.doll.torso();
        const tp = torso.translation();
        const tilt = this.doll.tiltOf(torso);
        const headY = this.doll.head().translation().y;
        if (this.doll.bodyHitGround()) {
          this.fallReason = "crash";
          this.fallDiag = { rH: +(this.initTorsoY * this.cfg.fallHeightRatio / Math.max(1e-6, tp.y)).toFixed(3), rT: +NaN.toFixed(3), rD: +NaN.toFixed(3), torsoY: +tp.y.toFixed(3), headY: +headY.toFixed(3), tiltDeg: 0, hit: this.doll.lastHitKey };
          this.finish(true);
          return true;
        }
        const useH = this.cfg.fallHeightRatio > 0;
        const rH = useH ? this.initTorsoY * this.cfg.fallHeightRatio / Math.max(1e-6, tp.y) : 0;
        const rT = tilt / this.cfg.fallAngle;
        const rD = this.cfg.headMinHeight / Math.max(1e-6, headY);
        if (useH && rH > 1 || rT > 1 || rD > 1) {
          this.fallReason = rT > 1 ? "tilt" : "head";
          this.fallDiag = {
            rH: +rH.toFixed(3),
            rT: +rT.toFixed(3),
            rD: +rD.toFixed(3),
            torsoY: +tp.y.toFixed(3),
            headY: +headY.toFixed(3),
            tiltDeg: +(tilt * 180 / Math.PI).toFixed(1),
            hit: this.doll.lastHitKey
          };
          this.finish(true);
          return true;
        }
        return false;
      }
      /** ★ 适应度分项（诊断用）。`total` 就是最终适应度；探针用它定位"站桩为什么是负分"。 */
      terms = {};
      /**
       * 适应度公式（walk / fight 两套）。抽成独立方法是为了让 `finish()` 和诊断接口
       * 共用**同一份公式** —— 以前诊断要复制一遍公式，改权重就会漏改（踩过）。
       */
      fitnessTerms(fallen, elapsed) {
        const w = this.w;
        if (this.cfg.mode === "stand") {
          const sw = STAND_W;
          const ts = {};
          ts.alive = sw.alive * elapsed;
          ts.single = sw.single * this.accSingle;
          ts.upright = sw.upright * (this.accUpright - elapsed);
          ts.height = -sw.height * this.accHeight;
          ts.lateral = -sw.lateral * this.accLateral;
          ts.tiltRate = -sw.tiltRate * this.accMoveSum;
          ts.quiet = 0;
          ts.velTrack = 0;
          ts.lift = 0;
          ts.jointMove = 0;
          ts.jointMotion = 0;
          ts.actRate = 0;
          ts.torque = 0;
          ts.yawTrack = 0;
          ts.total = Object.values(ts).reduce((a, b) => a + b, 0);
          return ts;
        }
        if (this.cfg.mode === "walk") {
          const tt = {};
          const aliveAvg = this.accAlive / Math.max(0.2, this.accTicks);
          tt.velTrack = w.velTrack * this.accVelTrack * aliveAvg * Math.min(1, this.altCount / 2);
          tt.yawTrack = w.yawTrack * this.accYaw;
          tt.lateral = -w.lateral * this.accLat;
          tt.tiltRate = -w.tiltRate * this.accTilt;
          let cad = 1;
          if (this.cycTimes.length >= 2) {
            const sc = [...this.cycTimes].sort((a, b) => a - b);
            cad = cadenceScore(sc[Math.floor(sc.length / 2)], TARGET_CYCLE);
          }
          const altGate = Math.min(1, this.altCount / 2);
          const gate = altGate * cad;
          const cap = (v, m) => v > m ? m : v;
          tt.cadence = cad;
          tt.cycle = cap(w.cycle * this.accCycle * aliveAvg, 6);
          tt.stillSwing = -w.stillSwing * this.accStill * aliveAvg;
          tt.stillStep = this.stillStep;
          tt.stillAdjust = this.stillAdjust;
          tt.cycleCount = this.cycleN;
          tt.cycleFlick = this.cycleFlick;
          tt.cycleAdjust = this.cycleAdj;
          tt.cyclePhase = this.gp.now === "adjust" ? 2 : this.gp.now === "step" ? 1 : 0;
          tt.medianCycle = this.cycTimes.length >= 2 ? [...this.cycTimes].sort((a, b) => a - b)[Math.floor(this.cycTimes.length / 2)] : 0;
          tt.lift = w.lift * this.accLift * aliveAvg * cad;
          tt.single = w.single * (this.accSwitchQ * aliveAvg + this.accSingle * cad);
          tt.altCount = this.altCount;
          tt.shift = w.shift * Math.min(this.accShift, this.cfg.shiftCapSec) * aliveAvg;
          tt.shiftRaw = this.accShift;
          let jm = 0, nJm = 0;
          for (const k of MOVE_JOINTS) {
            const v = this.accJtMove[k] ?? 0;
            tt[`mv.${k}`] = w.jointMove * (w.moveScale[k] ?? 1) * v * aliveAvg;
            jm += v;
            nJm++;
          }
          tt.jointMove = nJm > 0 ? w.jointMove * (jm / nJm) * aliveAvg : 0;
          tt.refHip = w.refHip * this.accRefHip * aliveAvg * Math.min(1, this.altCount / 2);
          tt.refKnee = w.refKnee * this.accRefKnee * aliveAvg * Math.min(1, this.altCount / 2);
          const pelL = this.accPelvisL, pelR = this.accPelvisR;
          const pelMean = (pelL + pelR) * 0.5;
          const pelWorst = Math.min(pelL, pelR);
          tt.pelvisFirst = w.pelvisFirst * pelMean * aliveAvg * Math.min(1, this.altCount / 2);
          tt.pelvisFirstL = pelL * aliveAvg;
          tt.pelvisFirstR = pelR * aliveAvg;
          tt.pelvisWorst = pelWorst * aliveAvg;
          tt.hipLeadSec = (this.pfL.meanLead + this.pfR.meanLead) / 2;
          tt.preActive = (this.pfL.preActiveRatio + this.pfR.preActiveRatio) / 2;
          const nTooFast = this.ssL.fastCount + this.ssR.fastCount;
          const paceCap = 1 + Math.floor(this.accTicks / 1.5);
          const altGate2 = altGate;
          tt.settle = cap(w.settle * (this.ssL.creditSum + this.ssR.creditSum) * aliveAvg * gate, 4);
          tt.stepPace = -w.stepPace * Math.min(nTooFast, paceCap) * aliveAvg;
          tt.moS = cap(w.moS * this.accMoS * aliveAvg * altGate, 1.5);
          const lenSum = this.ssL.lenCredit + this.ssR.lenCredit;
          tt.stepLen = cap(w.stepLen * lenSum * aliveAvg * altGate, 4);
          tt.meanStepLen = (this.ssL.meanStepLen + this.ssR.meanStepLen) / 2;
          tt.settledCount = this.ssL.settledCount + this.ssR.settledCount;
          tt.placement = cap(w.placement * this.accPlace * aliveAvg * altGate, 2);
          const bstat = this.bal.stats;
          const imbMean = bstat.ticks > 0 ? bstat.accImb / bstat.ticks : 0;
          const badHeadFrac = bstat.ticks > 0 ? bstat.badHead / bstat.ticks : 0;
          tt.imbalance = -w.imbalance * (imbMean + badHeadFrac) * aliveAvg;
          tt.imbMean = imbMean;
          tt.imbBadFrac = badHeadFrac;
          tt.imbAlive = aliveAvg;
          tt.imbW = w.imbalance;
          tt.wbamMax = bstat.wbamMax;
          tt.wbamNorm = this.bal.norms.wbam;
          tt.headRatioMin = bstat.headMin;
          tt.validRatio = this.accTicks > 0 ? this.validTicks / this.accTicks : 0;
          tt.footDist = this.footDist;
          tt.torsoDist = this.torsoDist;
          tt.flopRatio = Math.max(0, this.torsoDist - this.footDist);
          tt.settledSteps = this.ssL.settleRatio + this.ssR.settleRatio;
          tt.tooFastSteps = this.ssL.fastCount + this.ssR.fastCount;
          tt.flightSteps = this.ssL.flightCount + this.ssR.flightCount;
          tt.mosMin = this.mosMinSeen === Infinity ? 0 : this.mosMinSeen;
          tt.mosMean = this.mosN > 0 ? this.mosSum / this.mosN : 0;
          tt.unstableSteps = this.ssL.unstable + this.ssR.unstable;
          tt.recoveredSteps = this.ssL.recoveredCount + this.ssR.recoveredCount;
          this.settleDebug = `L[${this.ssL.debug()}] R[${this.ssR.debug()}]`;
          tt.alive = aliveAvg;
          tt.upright = w.upright * (this.accUpright - elapsed);
          tt.height = -w.height * this.accHeight;
          tt.jointMotion = -w.jointMotion * this.accJointMotion;
          tt.torque = -w.torque * this.accTau;
          tt.actRate = -w.actRate * this.accActRate;
          tt.energy = -w.energy * this.accEnergy;
          tt.survive = w.survive * elapsed;
          tt.fallen = fallen ? 1 : 0;
          let sum = 0;
          for (const k of WALK_REWARD_KEYS) sum += tt[k] ?? 0;
          tt.total = sum;
          return tt;
        }
        const t = {
          hit: w.hit * this.hits,
          hurt: -w.hurt * this.hurts,
          approach: w.approach * this.accClose,
          upright: w.upright * (this.accUpright - elapsed),
          height: -w.height * this.accHeight,
          balance: -w.balance * this.accBalance,
          smooth: -w.actRate * this.accActRate,
          // ★ 惩罚，负号（电机指令变化率）
          progress: 0.5 * this.progressRaw(),
          fall: fallen ? -w.fall : 0
        };
        t.total = Object.values(t).reduce((a, b) => a + b, 0);
        return t;
      }
      finish(fallen) {
        this.fallen = fallen;
        const elapsed = this.tick / this.cfg.controlHz;
        const w = this.w;
        this.endTorsoY = this.doll.torso().translation().y;
        this.endTilt = this.doll.tiltOf(this.doll.torso());
        this.endHeadY = this.doll.head().translation().y;
        this.inDomainRatio = this.balanceTicks > 0 ? this.inDomainTicks / this.balanceTicks : 0;
        this.terms = this.fitnessTerms(fallen, elapsed);
        const f = this.terms.total;
        this.fitness = f;
        this.finished = true;
        for (let i = 0; i < this.motor.length; i++) this.motor[i] = 0;
        this.doll.setMotorTargets(this.motor);
      }
      progressRaw() {
        return this.tick / this.ticksTotal;
      }
      /** 重新对齐物理世界（展示视图用：跑完一轮后让角色重新站好） */
      restand() {
        this.doll.reset(0);
        this.finished = false;
        this.fallen = false;
        this.subStep = 0;
        this.tick = 0;
        this.phase = 0;
        this.startX = this.doll.torso().translation().x;
      }
      /** 关掉这个 world 时的清理钩子（rapier 没有显式 free，交给 GC） */
      disposeHint() {
        for (const b of this.doll.bodies) b.setLinvel(ZERO2, false);
      }
    };
  }
});

// src/core/rig.ts
function groupOf(n) {
  if (n === "neck") return "\u9888";
  if (n.startsWith("shoulder")) return "\u80A9";
  if (n.startsWith("elbow")) return "\u8098";
  if (n.startsWith("hip")) return "\u9ACB";
  if (n.startsWith("knee")) return "\u819D";
  if (/^spine\d+$/.test(n)) return "\u8170";
  if (n.startsWith("foot") || n.startsWith("ankle")) return "\u8E1D";
  return "\u5176\u5B83";
}
function auditJoints(sk2) {
  const joints = [];
  const problems = [];
  const order = ["\u9888", "\u80A9", "\u8098", "\u9ACB", "\u819D", "\u8E1D", "\u8170", "\u5176\u5B83"];
  const names = [...sk2.joints.map((j) => j.name), ...PHANTOM_JOINTS];
  for (const name of names) {
    const idx = jointIndexByName(sk2, name);
    const exists = hasJoint(sk2, name);
    const base = JOINT_MAX_TORQUE[name] ?? 100;
    const def = exists ? sk2.joints[idx] : void 0;
    const axes = [];
    const jp = [];
    if (!exists) {
      jp.push("\u8BE5\u9AA8\u67B6\u6CA1\u6709\u8FD9\u4E2A\u5173\u8282");
      problems.push(`\u5173\u8282 ${name} \u5728 JOINT_ORDER \u91CC\u58F0\u660E\uFF0C\u4F46\u9AA8\u67B6\u91CC**\u4E0D\u5B58\u5728**\uFF08ankleEnabled=false\uFF1F\uFF09\u21D2 \u4EFB\u4F55\u6309\u540D\u5B57\u9A71\u52A8\u5B83\u7684\u4EE3\u7801\u90FD\u4E0D\u4F1A\u751F\u6548`);
    }
    for (let ax = 0; ax < 3; ax++) {
      const lo = def?.minRad[ax] ?? 0;
      const hi = def?.maxRad[ax] ?? 0;
      const span = Math.max(Math.abs(lo), Math.abs(hi));
      const tauMax = base * (TORQUE_AXIS_FACTOR[ax] ?? 1);
      let usable = exists && span > 0.05;
      let why = "";
      if (!exists) why = "\u5173\u8282\u4E0D\u5B58\u5728";
      else if (!usable) why = `\u9650\u4F4D\u8DE8\u5EA6\u4EC5 ${(span * 57.2958).toFixed(1)}\xB0\uFF08\u9501\u6B7B\uFF0C\u4E0D\u53EF\u9A71\u52A8\uFF09`;
      if (!usable && exists) {
        jp.push(`\u8F74${ax} ${AXIS_NAME[ax]} \u4E0D\u53EF\u9A71\u52A8\uFF1A${why}`);
        problems.push(`\u5173\u8282 ${name} \u8F74${ax}\uFF08${AXIS_NAME[ax]}\uFF09${why}`);
      }
      axes.push({ axis: ax, span, loDeg: lo * 57.2958, hiDeg: hi * 57.2958, tauMax, usable, why });
    }
    joints.push({
      name,
      index: idx,
      exists,
      group: groupOf(name),
      axes,
      usableAxes: axes.filter((a) => a.usable).length,
      problems: jp
    });
  }
  joints.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
  const inv = [];
  const realAxes = sk2.joints.length * 3;
  inv.push({
    id: "I3",
    ok: true,
    // 槽位多于实际轴不是错，但要**显式记账**，否则会以为踝在被控制
    msg: `\u5B9E\u9645\u53D7\u63A7\u8F74 ${realAxes}\uFF08${sk2.joints.length} \u5173\u8282 \xD73\uFF09\uFF1BPHANTOM_JOINTS \u58F0\u660E\u4E86 ${PHANTOM_JOINTS.length * 3} \u4E2A\u4E0D\u5B58\u5728\u7684\u8F74`
  });
  const hipAb = joints.find((j) => j.name === "hip_l")?.axes[1];
  if (hipAb?.usable) {
    inv.push({
      id: "A1",
      ok: false,
      msg: `hip/1\uFF08\u5916\u5C55\uFF09\u9650\u4F4D\u53EF\u7528\uFF08${hipAb.loDeg.toFixed(0)}\xB0~${hipAb.hiDeg.toFixed(0)}\xB0\uFF0C\u03C4=${hipAb.tauMax}N\xB7m\uFF09\uFF0C\u4F46**\u53CC\u811A\u652F\u6491\u4E0B\u5B9E\u6D4B \u0394CoM_z = 0**\uFF1A\u811A\u7740\u5730\u65F6\u817F\u6A2A\u5411\u8E6C\u4E0D\u52A8\u5730\u3002\u989D\u72B6\u9762\u5E73\u8861\u53EA\u80FD\u8D70 spine1/0\uFF08\u5B9E\u6D4B \u0394z=35mm\uFF09\u3002\u89C1 tools/probe-authority.ts`
    });
  }
  const spineLat = joints.find((j) => j.name === "spine1")?.axes[1];
  if (spineLat?.usable) {
    inv.push({
      id: "A2",
      ok: false,
      msg: `spine1/1\uFF08\u8170\u4FA7\u503E\uFF09\u9650\u4F4D\u53EF\u7528\u4F46**\u5B9E\u6D4B \u0394CoM_z = 4mm \u2248 0**\uFF1B\u771F\u6B63\u80FD\u6A2A\u79FB CoM \u7684\u662F spine1/**0**\uFF0835mm\uFF09\u3002\u21D2 \u8170\u7684"\u4FA7\u503E"\u901A\u9053\u65E0\u6548\uFF0C\u522B\u5199\u8FDB\u63A7\u5236\u5668`
    });
  }
  const ankle = joints.find((j) => j.name === "foot_l");
  if (ankle && !ankle.exists) {
    inv.push({
      id: "A3",
      ok: false,
      msg: "**\u672C rig \u6CA1\u6709\u8E1D\u5173\u8282** \u21D2 \u6CA1\u6709 CoP \u901A\u9053 \u21D2 \u77E2\u72B6\u9762\u53EA\u5269\u9ACB\u7B56\u7565\u3002balanceHold \u91CC\u6240\u6709 ankleSag/ankleLat/kVipP \u8DEF\u5F84\u76EE\u524D\u662F\u7A7A\u8F6C\u7684"
    });
  }
  return {
    bodyCount: sk2.bodies.length,
    jointCount: sk2.joints.length,
    axisSlots: (sk2.joints.length + PHANTOM_JOINTS.length) * 3,
    joints,
    invariants: inv,
    problems,
    ok: inv.every((v) => v.ok)
  };
}
function assertRigInvariants(sk2, shape) {
  const report = auditJoints(sk2);
  for (let i = 0; i < sk2.joints.length; i++) {
    const nm = sk2.joints[i].name;
    const back = jointIndexByName(sk2, nm);
    if (back !== i) {
      throw new Error(
        `[rig] \u5173\u8282\u540D\u4E0E\u7D22\u5F15\u4E0D\u4E00\u81F4\uFF1Ask.joints[${i}].name="${nm}"\uFF0C\u4F46 jointIndexByName \u67E5\u56DE ${back}\u3002\u8FD9\u4F1A\u8BA9\u6309\u540D\u5B57\u9A71\u52A8\u9759\u9ED8\u4F5C\u7528\u5230\u522B\u7684\u5173\u8282\u4E0A\u3002`
      );
    }
  }
  for (const nm of PHANTOM_JOINTS) {
    if (hasJoint(sk2, nm)) continue;
  }
  const sh = shape ?? shapeForJoints(sk2.joints.length);
  const expIn = 36 + 6 * sk2.joints.length;
  const expOut = 3 * sk2.joints.length;
  if (sh.inputs !== expIn || sh.outputs !== expOut) {
    throw new Error(
      `[rig] \u7F51\u7EDC\u5F62\u72B6\u4E0E\u9AA8\u67B6\u4E0D\u7B26\uFF1A${sh.inputs}\u2192${sh.outputs}\uFF0C\u4F46 ${sk2.joints.length} \u5173\u8282\u8981\u6C42 ${expIn}\u2192${expOut}\u3002\uFF08\u5386\u53F2\u4E8B\u6545\uFF1ABRAIN_SHAPE \u662F 9 \u5173\u8282\u7684\u9ED8\u8BA4\u503C\uFF0C\u7528\u5728 12 \u5173\u8282\u9AA8\u67B6\u4E0A \u21D2 \u89C2\u6D4B\u9759\u9ED8\u622A 18 \u7EF4\u3001\u53EA\u9A71\u52A8 9/12 \u5173\u8282\u300110 \u6B65\u5185 com \u5168 NaN \u800C\u4E0D\u62A5\u9519\uFF09`
    );
  }
  return report;
}
function rigSummary(r) {
  const usable = r.joints.reduce((s, j) => s + j.usableAxes, 0);
  return `${r.bodyCount} \u521A\u4F53 / ${r.jointCount} \u5173\u8282 / \u53EF\u9A71\u52A8\u8F74 ${usable} / \u5E7D\u7075\u5173\u8282 ${PHANTOM_JOINTS.length}\uFF08\u8E1D\uFF09`;
}
var AXIS_NAME, PHANTOM_JOINTS;
var init_rig = __esm({
  "src/core/rig.ts"() {
    "use strict";
    init_skeleton();
    init_brain();
    AXIS_NAME = ["\u5185\u5916\u65CB", "\u5916\u5C55/\u4FA7\u503E", "\u5C48\u4F38"];
    PHANTOM_JOINTS = ["foot_l", "foot_r"];
  }
});

// src/core/rigState.ts
function cloneCriteria(c) {
  return { flags: { ...c.flags }, values: { ...c.values }, all: c.all };
}
function makeCriteria(flags, values) {
  const ks = Object.keys(flags);
  return { flags, values, all: ks.length > 0 && ks.every((k) => flags[k]) };
}
var PRIORITY, DEFAULT_RIGSTATE_CONFIG, RigState;
var init_rigState = __esm({
  "src/core/rigState.ts"() {
    "use strict";
    init_skeleton();
    PRIORITY = { balance: 0, step: 1 };
    DEFAULT_RIGSTATE_CONFIG = {
      slewLimit: 8,
      waistSlotMax: 6 * Math.PI / 180,
      mosBudgetZ: 25e-4
    };
    RigState = class {
      sk;
      cfg;
      // ── 身份（唯一真源）
      loadBearer = null;
      locked = { l: false, r: false };
      phase = "DOUBLE";
      phaseT = 0;
      authority = 0;
      // ── 读数（每拍从物理回读一次，两系统共享）
      pos;
      vel;
      loadFrac = { l: 0, r: 0 };
      grounded = { l: false, r: false };
      com = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      dcm = { x: 0, z: 0 };
      support = { cx: 0, cz: 0, halfX: 0, halfZ: 0, halfZActive: 0, contactN: 0 };
      mos = 0;
      grf = { x: 0, y: 0 };
      torsoY = 0;
      tiltDeg = 0;
      soleX = { l: 0, r: 0 };
      /**
       * 脚底中心的**横向**位置（m）。
       * ★ 两脚在 Z 向分开（z ≈ ±0.10）⇒ **左右载荷分配由 CoM.z 决定**，
       *   所以额状面平衡的目标量必须是这个，不是支撑域中心（两脚中点）。
       */
      soleZ = { l: 0, r: 0 };
      /** 脚底离地高度（m）。UI 显示用；必须与快照同源，所以存在状态里 */
      soleY = { l: 0, r: 0 };
      /** ★ 真·压力中心（由接触冲量加权，`Ragdoll.readCoP`）—— 足部"发力"的直接测量 */
      cop = {
        l: { x: 0, z: 0, load: 0 },
        r: { x: 0, z: 0, load: 0 }
      };
      // ── 仲裁
      //  ⚠⚠ 用**固定长度 + fill(undefined)** 清空，**不要**用 `length = 0`：
      //     那会把数组真的清空，于是 `i >= this.req.length` 恒成立 ⇒
      //     `request()` 全部静默 return ⇒ 控制器退化成开环，而所有指标看起来"正常"，
      //     只有增益扫描会暴露（16 行逐位相同）。已踩过。
      req = [];
      /** 本拍真正被登记的需求数（诊断用：0 ⇒ 控制器根本没在控制） */
      requestCount = 0;
      /** 越界请求累计（应当恒为 0；非 0 说明有调用方用了不存在的关节/轴） */
      badRequests = 0;
      nAxes;
      tgt = [];
      prevTarget;
      // ── 事件
      touchdown = { l: false, r: false };
      lockReleased = { l: false, r: false };
      // ── 判据（由 gaitState 写入，逐条回读）
      bearerCriteria = { flags: {}, values: {}, all: false };
      unlockCriteria = { flags: {}, values: {}, all: false };
      stepPermit = { flags: {}, values: {}, all: false };
      tickNo = 0;
      tSec = 0;
      /** 上一拍的 target，供斜率限制 */
      prevOut;
      constructor(sk2, cfg = DEFAULT_RIGSTATE_CONFIG) {
        this.sk = sk2;
        this.cfg = cfg;
        const n = sk2.joints.length * 3;
        this.nAxes = n;
        this.pos = new Float64Array(n);
        this.vel = new Float64Array(n);
        this.prevTarget = new Float32Array(n);
        this.prevOut = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          this.tgt.push({
            value: 0,
            owner: "none",
            ownerLabel: "\u2014",
            tag: "none",
            suppressed: [],
            vetoed: [],
            clamped: false
          });
        }
      }
      // ── 读写接口（两系统只能用这些）────────────────────────────
      bearer() {
        return this.loadBearer;
      }
      /**
       * 承重腿；**没有标识时退化为"当前实际在承重的那条"**。
       *
       * ⚠ 双支撑时**必须取载荷大的那条**，不能写死 `'l'`：
       *   曾写死左脚，于是判据在评估一条只承担 29% 的腿，而右腿承担 71%
       *   ⇒ B2 永远不达标 ⇒ 承重标识永远授不出来 ⇒ 迈步许可 P1 永远为 false
       *   ⇒ 表现是"控制器完全不动"，但所有指标看起来都在正常回读。
       */
      supportLeg() {
        if (this.loadBearer) return this.loadBearer;
        if (this.grounded.l && !this.grounded.r) return "l";
        if (this.grounded.r && !this.grounded.l) return "r";
        if (this.grounded.l && this.grounded.r) {
          if (this.loadFrac.l > this.loadFrac.r + 1e-3) return "l";
          if (this.loadFrac.r > this.loadFrac.l + 1e-3) return "r";
          if (this.locked.l) return "l";
          if (this.locked.r) return "r";
          return "l";
        }
        return "l";
      }
      swingLeg() {
        return this.supportLeg() === "l" ? "r" : "l";
      }
      isLocked(s) {
        return this.locked[s];
      }
      jointPos(joint, axis) {
        return this.pos[joint * 3 + axis] ?? 0;
      }
      /** 按真实索引取角（重构后的内部统一用这个；名字查询只用于外部配置） */
      angle(joint, axis = 2) {
        return this.pos[joint * 3 + axis] ?? 0;
      }
      jointVel(joint, axis) {
        return this.vel[joint * 3 + axis] ?? 0;
      }
      /** 按名字取当前角；关节不存在返回 NaN（**调用方必须处理，不许静默当 0**） */
      angleOf(name, axis = 2) {
        const i = jointIndexByName(this.sk, name);
        if (i < 0) return NaN;
        return this.pos[i * 3 + axis] ?? 0;
      }
      /**
       * ★ 提需求。两个系统**并发**调用同一个 `rigState`，由 `arbitrate()` 合并。
       *   注意语义：这是"登记意图"，**不直接改 target**。
       */
      request(joint, axis, value, system, label) {
        const i = joint * 3 + axis;
        if (i < 0 || i >= this.nAxes) {
          this.badRequests++;
          return;
        }
        const cur = this.req[i];
        this.requestCount++;
        if (cur && PRIORITY[cur.system] <= PRIORITY[system]) {
          this.tgt[i].suppressed.push({ system, label });
          return;
        }
        if (cur) this.tgt[i].suppressed.push({ system: cur.system, label: cur.label });
        this.req[i] = { value, system, label };
      }
      /**
       * ★★ 按**角度**提需求（内部换算成该轴量程的比例）。
       *
       *   为什么需要它：`request()` 收的是**目标角比例**（`-1..1`，映射到该轴量程），
       *   直接传 PD 的输出是**量纲错误** —— 会把"膝该往回顶一点"变成
       *   "命令膝弯 46°"，实测开局就深蹲塌下去。
       *   ⇒ 控制器里凡是"我要这个角"的语义，都必须走这个接口。
       */
      requestAngle(joint, axis, rad, system, label) {
        const def = this.sk.joints[joint];
        if (!def) {
          this.badRequests++;
          return;
        }
        const span = Math.max(Math.abs(def.minRad[axis]), Math.abs(def.maxRad[axis]));
        if (span <= 1e-6) {
          this.badRequests++;
          return;
        }
        this.request(joint, axis, rad * 0.9 / span, system, label);
      }
      /** 锁定闸门：被锁定腿上的抬腿需求**直接丢弃**（不是加权、不是夹紧） */
      requestSwingLeg(side, joint, axis, value, label, isLift) {
        if (isLift && this.locked[side]) {
          const i = joint * 3 + axis;
          if (i >= 0 && i < this.nAxes) this.tgt[i].vetoed.push({ system: "step", label });
          return;
        }
        this.request(joint, axis, value, "step", label);
      }
      /** 同上，但按**角度**提需求 */
      requestSwingLegAngle(side, joint, axis, rad, label, isLift) {
        const def = this.sk.joints[joint];
        if (!def) {
          this.badRequests++;
          return;
        }
        if (isLift && this.locked[side]) {
          const i = joint * 3 + axis;
          if (i >= 0 && i < this.nAxes) this.tgt[i].vetoed.push({ system: "step", label });
          return;
        }
        this.requestAngle(joint, axis, rad, "step", label);
      }
      /**
       * ★ 腰的**受限修正槽**：迈步系统只能提一个**有界**的修正量。
       *   幅度上限 `waistSlotMax`（文献：骨盆横断面旋转 6°）
       *   且乘上权限预算 α(t)。
       *   超出部分被夹住并标记 —— 可见，不静默。
       */
      requestWaistSlot(joint, axis, rad, label) {
        const def = this.sk.joints[joint];
        if (!def) {
          this.badRequests++;
          return;
        }
        const span = Math.max(Math.abs(def.minRad[0]), Math.abs(def.maxRad[0]));
        if (span <= 1e-6) {
          this.badRequests++;
          return;
        }
        const capRad = this.cfg.waistSlotMax * this.authority;
        const v = Math.max(-capRad, Math.min(capRad, rad));
        this.requestAngle(
          joint,
          axis,
          v,
          "step",
          label + (Math.abs(v - rad) > 1e-9 ? `(\u5939\u5230${(capRad * 57.3).toFixed(1)}\xB0)` : "")
        );
      }
      // ── 仲裁 ────────────────────────────────────────────────
      /** 每拍开始：清空需求与仲裁痕迹 */
      beginTick(dt) {
        this.tickNo++;
        this.tSec += dt;
        this.req.fill(void 0);
        this.requestCount = 0;
        for (let i = 0; i < this.tgt.length; i++) {
          const t = this.tgt[i];
          t.suppressed.length = 0;
          t.vetoed.length = 0;
          t.clamped = false;
          t.owner = "none";
          t.ownerLabel = "\u2014";
          t.tag = "none";
          t.value = 0;
        }
        this.touchdown.l = false;
        this.touchdown.r = false;
        this.lockReleased.l = false;
        this.lockReleased.r = false;
      }
      /** 每拍结束：合并成唯一的 target，返回可直接喂给 `setMotorTargets` 的数组 */
      arbitrate(dt) {
        const out = this.prevOut;
        const maxStep = this.cfg.slewLimit * dt;
        for (let i = 0; i < this.nAxes; i++) {
          const r = this.req[i];
          const t = this.tgt[i];
          if (!r || !t) {
            out[i] = this.prevTarget[i] ?? 0;
            continue;
          }
          t.value = r.value;
          t.owner = r.system;
          t.ownerLabel = r.label;
          t.tag = r.system === "balance" ? "hold" : "step";
          const prev = this.prevTarget[i] ?? 0;
          const d = r.value - prev;
          if (Math.abs(d) > maxStep) {
            out[i] = prev + Math.sign(d) * maxStep;
            t.clamped = true;
          } else {
            out[i] = r.value;
          }
        }
        for (let i = 0; i < out.length; i++) {
          if (!this.req[i]) {
            out[i] = this.prevTarget[i] ?? 0;
            const t = this.tgt[i];
            if (t.owner === "none") {
              t.owner = "bind";
              t.ownerLabel = "\u4FDD\u6301";
              t.tag = "servo";
            }
          }
        }
        for (let i = 0; i < out.length; i++) this.prevTarget[i] = out[i];
        return out;
      }
      targets() {
        return this.tgt;
      }
      // ── 快照（唯一可读出口）─────────────────────────────────
      /** 每拍产出一次，**整体替换** ⇒ 持有旧快照不会被后续 tick 改变 */
      snapshot(limitHit = []) {
        const footL = this.soleX.l, footR = this.soleX.r;
        const front = footL >= footR ? "l" : "r";
        const axes = [];
        for (let j = 0; j < this.sk.joints.length; j++) {
          for (let a = 0; a < 3; a++) {
            const i = j * 3 + a;
            const t = this.tgt[i];
            axes.push({
              key: `${this.sk.joints[j].name}/${a}`,
              joint: j,
              axis: a,
              pos: this.pos[i] ?? 0,
              vel: this.vel[i] ?? 0,
              target: this.prevTarget[i] ?? 0,
              owner: t.owner,
              ownerLabel: t.ownerLabel,
              tag: t.tag,
              suppressed: t.suppressed.map((x) => ({ ...x })),
              vetoed: t.vetoed.map((x) => ({ ...x })),
              clamped: t.clamped,
              limitHit: !!limitHit[i]
            });
          }
        }
        return {
          tick: this.tickNo,
          t: this.tSec,
          phase: this.phase,
          phaseT: this.phaseT,
          loadBearer: this.loadBearer,
          supportLeg: this.supportLeg(),
          swingLeg: this.swingLeg(),
          locked: { ...this.locked },
          authority: this.authority,
          com: { ...this.com },
          dcm: { ...this.dcm },
          support: { ...this.support },
          mos: this.mos,
          grf: { ...this.grf },
          torsoY: this.torsoY,
          tiltDeg: this.tiltDeg,
          legs: {
            l: {
              side: "l",
              grounded: this.grounded.l,
              loadFrac: this.loadFrac.l,
              soleY: this.soleY.l,
              cop: { ...this.cop.l },
              isFront: front === "l",
              isBack: front !== "l",
              isBearer: this.loadBearer === "l",
              locked: this.locked.l
            },
            r: {
              side: "r",
              grounded: this.grounded.r,
              loadFrac: this.loadFrac.r,
              soleY: this.soleY.r,
              cop: { ...this.cop.r },
              isFront: front === "r",
              isBack: front !== "r",
              isBearer: this.loadBearer === "r",
              locked: this.locked.r
            }
          },
          axes,
          criteria: {
            bearer: cloneCriteria(this.bearerCriteria),
            unlock: cloneCriteria(this.unlockCriteria),
            stepPermit: cloneCriteria(this.stepPermit)
          },
          events: {
            touchdownL: this.touchdown.l,
            touchdownR: this.touchdown.r,
            lockReleasedL: this.lockReleased.l,
            lockReleasedR: this.lockReleased.r
          }
        };
      }
    };
  }
});

// src/core/gaitState.ts
function cdf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function smoothAuthority(phase, phaseT, ramp, sigma) {
  if (phase !== "STEP") return 0;
  const p = Math.max(0, Math.min(1, phaseT / Math.max(1e-6, ramp)));
  const ramped = Math.min(1, 1.5 * p);
  return 0.5 * (1 + cdf((ramped - 0.5) / Math.max(1e-6, sigma)));
}
var DEFAULT_GAIT_CONFIG, PHASE_ORDER, PHASE_LABEL, GaitState;
var init_gaitState = __esm({
  "src/core/gaitState.ts"() {
    "use strict";
    init_rigState();
    DEFAULT_GAIT_CONFIG = {
      bearerLoad: 0.6,
      bearerLoadHyst: 0.45,
      bearerMosMin: 0,
      bearerHoldSec: 0.08,
      unlockMosHoldSec: 0.12,
      unlockTiltMaxDeg: 20,
      permitMosMin: 0,
      permitDoubleSupportSec: 0.05,
      alphaSigma: 0.08,
      singleLeg: "l",
      liftHold: 0.25
    };
    PHASE_ORDER = ["DOUBLE", "SHIFT", "SINGLE", "PUSH", "STEP"];
    PHASE_LABEL = {
      DOUBLE: "\u53CC\u811A\u652F\u6491",
      SHIFT: "\u91CD\u5FC3\u8F6C\u79FB",
      SINGLE: "\u5355\u652F\u6491",
      PUSH: "\u8E6C\u79BB",
      STEP: "\u6446\u52A8\u76F8"
    };
    GaitState = class {
      constructor(rs, cfg = DEFAULT_GAIT_CONFIG) {
        this.rs = rs;
        this.cfg = cfg;
      }
      cfg;
      /** 上一次的承重判据连续满足时长 */
      bearerT = 0;
      unlockT = 0;
      /** 上一次是否已授予承重（用于迟滞撤销） */
      hadBearer = false;
      /** 双支撑相已持续时长 */
      doubleT = 0;
      /** 本拍刚触地（边沿） */
      wasGrounded = { l: false, r: false };
      event = { kind: "none", note: "" };
      phaseLabel(p) {
        return PHASE_LABEL[p];
      }
      phaseOrder(p) {
        return PHASE_ORDER.indexOf(p);
      }
      /** ★ 每拍调用一次：更新判据 → 迁移状态 → 写回 rigState（含 α） */
      update(dt) {
        const rs = this.rs;
        this.event.kind = "none";
        this.event.note = "";
        this.event.side = void 0;
        const supSide = rs.supportLeg();
        const swing = rs.swingLeg();
        const bothGrounded = rs.grounded.l && rs.grounded.r;
        if (bothGrounded) this.doubleT += dt;
        else this.doubleT = 0;
        for (const s of ["l", "r"]) {
          if (rs.grounded[s] && !this.wasGrounded[s]) {
            rs.touchdown[s] = true;
            this.wasGrounded[s] = true;
          } else if (!rs.grounded[s]) this.wasGrounded[s] = false;
        }
        const lf = rs.loadFrac[supSide], rf = rs.loadFrac[swing];
        const thr = this.hadBearer ? this.cfg.bearerLoadHyst : this.cfg.bearerLoad;
        const B1 = rs.grounded[supSide];
        const B2 = lf >= thr;
        const B3 = rs.mos >= this.cfg.bearerMosMin;
        const B4 = this.bearerT >= this.cfg.bearerHoldSec;
        if (B1 && B2 && B3) this.bearerT += dt;
        else this.bearerT = 0;
        rs.bearerCriteria = makeCriteria(
          { B1_\u63A5\u5730: B1, B2_\u8F7D\u8377: B2, B3_MoS: B3, B4_\u6301\u7EED: B4 },
          { loadFrac: lf, thr, mos: rs.mos, holdSec: this.bearerT, otherLoad: rf }
        );
        const U1 = rs.loadBearer !== null;
        const U2 = rs.mos >= this.cfg.permitMosMin;
        const U3 = rs.tiltDeg <= this.cfg.unlockTiltMaxDeg;
        if (U2 && U3) this.unlockT += dt;
        else this.unlockT = 0;
        const U4 = this.unlockT >= this.cfg.unlockMosHoldSec;
        for (const s of ["l", "r"]) {
          const held = U1 && rs.loadBearer === s && U4;
          rs.unlockCriteria = makeCriteria(
            { U1_\u627F\u91CD\u8FBE\u6807: held, U2_MoS: U2, U3_\u503E\u89D2: U3, U4_\u7A33\u5B9A\u7A97: U4 },
            { mos: rs.mos, tiltDeg: rs.tiltDeg, winSec: this.unlockT, needSec: this.cfg.unlockMosHoldSec, held: held ? 1 : 0 }
          );
          if (rs.locked[s] && held) {
            rs.locked[s] = false;
            rs.lockReleased[s] = true;
            this.event.kind = "lock_released";
            this.event.side = s;
            this.event.note = "\u89E3\u9501\uFF0C\u5141\u8BB8\u518D\u62AC";
          }
        }
        const swingLocked = rs.locked[swing];
        const P1 = rs.bearerCriteria.flags["B2_\u8F7D\u8377"] === true;
        const P2 = !swingLocked;
        const P3 = rs.mos >= this.cfg.permitMosMin;
        const P4 = this.doubleT >= this.cfg.permitDoubleSupportSec;
        rs.stepPermit = makeCriteria(
          { P1_\u91CD\u5FC3\u5230\u4F4D: P1, P2_\u672A\u9501\u5B9A: P2, P3_MoS: P3, P4_\u53CC\u652F\u6491\u65F6\u957F: P4 },
          { mos: rs.mos, doubleSec: this.doubleT, swingLocked: swingLocked ? 1 : 0 }
        );
        const prev = rs.phase;
        this.migrate(prev, dt, bothGrounded, supSide, swing);
        if (rs.phase !== prev && this.event.kind === "none") {
          this.event.kind = rs.phase === "STEP" ? "enter_step" : "none";
          this.event.note = `${prev} \u2192 ${rs.phase}`;
        }
        rs.phaseT += dt;
        if (!this.hadBearer && rs.bearerCriteria.all) {
          rs.loadBearer = supSide;
          this.hadBearer = true;
          this.event.kind = "bearer_granted";
          this.event.side = supSide;
          this.event.note = `\u627F\u91CD\u6807\u8BC6\u6388\u4E88 ${supSide}\uFF08\u8F7D\u8377 ${lf.toFixed(2)} / MoS ${(rs.mos * 1e3).toFixed(0)}mm\uFF09`;
        } else if (this.hadBearer && rs.loadBearer) {
          const cur = rs.loadBearer;
          if (!rs.grounded[cur] || rs.loadFrac[cur] < this.cfg.bearerLoadHyst) {
            rs.loadBearer = null;
            this.hadBearer = false;
            this.bearerT = 0;
          }
        }
        const ramp = this.cfg.singleLeg ? 1.2 : 0.4;
        rs.authority = smoothAuthority(rs.phase, rs.phaseT, ramp, this.cfg.alphaSigma);
        return this.event;
      }
      migrate(prev, dt, both, supSide, swing) {
        const rs = this.rs;
        switch (prev) {
          case "DOUBLE":
            if (this.cfg.singleLeg) {
              if (rs.phaseT > 0.2) {
                rs.phase = "SINGLE";
              }
              break;
            }
            if (rs.phaseT > 0.15 && (rs.loadFrac[swing] > 0.25 || rs.touchdown[swing])) rs.phase = "SHIFT";
            break;
          case "SHIFT":
            if (rs.bearerCriteria.all) {
              rs.phase = "SINGLE";
              rs.phaseT = 0;
            } else if (rs.phaseT > 1.5) rs.phase = "DOUBLE";
            break;
          case "SINGLE":
            if (rs.phaseT > 0.15) rs.phase = "PUSH";
            break;
          case "PUSH":
            if (rs.stepPermit.all && both) rs.phase = "STEP";
            else if (rs.phaseT > 0.5) rs.phase = "SINGLE";
            break;
          case "STEP":
            if (rs.touchdown[swing]) {
              rs.locked[swing] = true;
              rs.phase = "SHIFT";
              rs.phaseT = 0;
            } else if (rs.phaseT > 1.5) {
              rs.phase = "DOUBLE";
              rs.phaseT = 0;
            }
            break;
        }
        if (this.cfg.singleLeg && rs.phase === "DOUBLE" && rs.phaseT > 0.6) rs.phase = "SINGLE";
      }
      reset() {
        this.bearerT = 0;
        this.unlockT = 0;
        this.hadBearer = false;
        this.doubleT = 0;
        this.wasGrounded.l = false;
        this.wasGrounded.r = false;
        this.rs.loadBearer = null;
        this.rs.locked.l = false;
        this.rs.locked.r = false;
        this.rs.phase = "DOUBLE";
        this.rs.phaseT = 0;
        this.rs.authority = 0;
      }
    };
  }
});

// src/core/systems/balance.ts
function balanceSystem(rs, p = DEFAULT_BALANCE_PARAMS) {
  const sk2 = rs.sk;
  const sup = rs.supportLeg();
  const jHip = jointIndexByName(sk2, sup === "l" ? "hip_l" : "hip_r");
  const jKnee = jointIndexByName(sk2, sup === "l" ? "knee_l" : "knee_r");
  const jSp1 = jointIndexByName(sk2, "spine1");
  const jSp2 = jointIndexByName(sk2, "spine2");
  const jAnk = jointIndexByName(sk2, sup === "l" ? "foot_l" : "foot_r");
  if (jHip < 0 || jKnee < 0 || jSp1 < 0) {
    rs.request(-1, 0, 0, "balance", "\u9AA8\u67B6\u7F3A\u652F\u6491\u817F/\u8170\u5173\u8282");
    return;
  }
  const clamp = (v, m) => v > m ? m : v < -m ? -m : v;
  const D2R2 = Math.PI / 180;
  const OFF = new Set((p.ablate ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const on = (ch) => !OFF.has(ch);
  const ex = rs.com.x;
  let hipTgt = -p.kSagP * ex - p.kSagD * rs.com.vx;
  hipTgt = clamp(hipTgt, p.maxHip);
  if (on("hip")) rs.requestAngle(jHip, 2, hipTgt, "balance", "\u9ACB\u7B56\u7565");
  const kneeNow = rs.angle(jKnee, 2);
  const kneeLimit = -Math.abs(p.kneeHoldDeg) * D2R2;
  if (on("knee") && kneeNow < kneeLimit) {
    rs.requestAngle(jKnee, 2, kneeLimit, "balance", "\u819D\u5B88\u536B");
  }
  const hipNow2 = rs.angle(jHip, 2);
  if (on("hip") && hipNow2 < -p.hipExtendLimit) {
    rs.requestAngle(jHip, 2, -p.hipExtendLimit, "balance", "\u9ACB\u5C48\u5B88\u536B");
  }
  const grfAng = Math.atan2(rs.grf.x, Math.max(0.2, rs.grf.y));
  const sp1Sag = clamp(-grfAng * p.kTorsoAlign - ex * 0.8, p.maxTorso);
  if (on("torso")) rs.requestAngle(jSp1, 2, sp1Sag, "balance", "\u8EAF\u5E72\u529B\u7EBF");
  const latArmed = rs.loadBearer !== null || rs.phase === "SINGLE" || rs.phase === "SHIFT" || rs.phase === "PUSH";
  if (latArmed) {
    const stanceZ = sup === "l" ? rs.soleZ.l : rs.soleZ.r;
    const dz = rs.com.z - stanceZ;
    const hipAbd = clamp(
      p.hipAbdSign * (p.kHipAbd * dz + p.kHipAbdD * rs.com.vz),
      p.maxHipAbd
    );
    if (on("lat")) rs.requestAngle(jHip, 1, hipAbd, "balance", "\u652F\u6491\u9ACB\u5916\u5C55");
    if (on("latwaist")) {
      const wl = clamp(p.hipAbdSign * p.kWaistLat * dz, p.maxWaistLat);
      rs.requestAngle(jSp1, 0, wl, "balance", "\u8170\u989D\u72B6\u4FEE\u8FB9");
    }
  }
  if (jSp2 >= 0 && on("torso")) rs.requestAngle(jSp2, 2, clamp(sp1Sag * 0.4, p.maxTorso * 0.6), "balance", "\u8170\u4E0A\u6BB5");
  if (jAnk >= 0) {
    const cop = rs.cop[sup];
    const copErr = rs.dcm.x - cop.x;
    let ankSag = -p.kCopSag * copErr - p.kCopSagD * rs.com.vx;
    if (rs.phase === "PUSH") ankSag += Math.abs(p.pushDeg) * D2R2;
    ankSag = clamp(ankSag, p.maxAnkleSag);
    rs.requestAngle(jAnk, 2, ankSag, "balance", "\u8E1DCoP\u8C03\u8282");
    const latErr = rs.dcm.z - cop.z;
    rs.requestAngle(jAnk, 0, clamp(p.kCopLat * latErr, p.maxAnkleLat), "balance", "\u8E1D\u989D\u72B6CoP");
  }
}
var DEFAULT_BALANCE_PARAMS;
var init_balance2 = __esm({
  "src/core/systems/balance.ts"() {
    "use strict";
    init_skeleton();
    DEFAULT_BALANCE_PARAMS = {
      kSagP: 2.2,
      kSagD: 0,
      kTorsoAlign: 1,
      // ★ 旧额状面律（走 spine1/0）保留但**默认不用**：它权限 35mm、需求 100mm ⇒ 发散。
      //   见 §17：主通道已换成支撑髋外展（kHipAbd）。留这个字段是为了可对照消融。
      kLatP: 0,
      kLatD: 0,
      kneeHoldDeg: 15,
      kKnee: 0.6,
      kHipUpright: 0.8,
      maxHip: 0.52,
      maxKnee: 0.35,
      maxTorso: 0.14,
      // ★ 符号由实测定（tools/probe-authority.ts，ANKLE=1）：
      //   foot_l/2 目标角 +7.2° ⇒ ΔCoM_x = +22 mm
      //   ⇒ **正角（跖屈，脚尖下压）把 CoP / CoM 往前推**
      //   LIPM：CoP 在 CoM **前方** ⇒ 力矩把 CoM 往**后**拉
      //   ⇒ 要把 ξ 拉回 0（ζ 超前）就要 CoP 前移 ⇒ 踝角 = +k·ξ
      // 闭环在 CoP 上：单位是 m/m = 无量纲 ⇒ 增益就是"角度/误差"
      kCopSag: 6,
      kCopSagD: 0,
      kCopLat: 2,
      pushDeg: 12,
      maxAnkleSag: 0.2,
      maxAnkleLat: 0.12,
      // 目标角限幅：髋/1 量程 ±40°，取 ±18° 留裕度
      kHipAbd: 3,
      kHipAbdD: 0,
      maxHipAbd: 0.31,
      // 腰只做修边：幅度给到髋的 ~1/3
      kWaistLat: 0.5,
      maxWaistLat: 0.09,
      // ★ 实测标定：+1 发散（com.z → +521~640 mm），−1 收敛（+48~194 mm）
      hipAbdSign: -1,
      // 髋允许的屈曲上限：绑姿态 ≈0，单支撑时超过就会整体下蹲
      hipExtendLimit: 0.12
    };
  }
});

// src/core/systems/step.ts
function stepSystem(rs, p = DEFAULT_STEP_PARAMS) {
  const sk2 = rs.sk;
  const swing = rs.swingLeg();
  const jHip = jointIndexByName(sk2, swing === "l" ? "hip_l" : "hip_r");
  const jKnee = jointIndexByName(sk2, swing === "l" ? "knee_l" : "knee_r");
  const jSp1 = jointIndexByName(sk2, "spine1");
  const jSp2 = jointIndexByName(sk2, "spine2");
  const jSp3 = jointIndexByName(sk2, "spine3");
  if (jHip < 0 || jKnee < 0) return;
  const clamp = (v, m) => v > m ? m : v < -m ? -m : v;
  const D2R2 = Math.PI / 180;
  const permit = rs.stepPermit.all;
  const s = rs.phase === "STEP" ? Math.max(0, Math.min(1, rs.phaseT / Math.max(1e-6, p.halfPeriod))) : rs.phase === "DOUBLE" || rs.phase === "SHIFT" ? 0 : 1;
  const bell = Math.sin(Math.PI * s);
  const hold = rs.phase === "SINGLE" || rs.phase === "STEP";
  const lift = permit && hold ? p.lift * bell + (s >= 1 ? p.liftHold : 0) : rs.phase === "SINGLE" ? p.liftHold : 0;
  const hipDeg = p.hipFlexPeakDeg * bell;
  rs.requestSwingLegAngle(swing, jHip, 2, clamp(-hipDeg * D2R2, 0.6), "\u6446\u52A8\u9ACB\u5C48", lift > 0.01);
  const kneeDeg = p.kneeFlexPeakDeg * bell;
  rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kneeDeg * D2R2, 1.2), "\u6446\u52A8\u819D\u5C48", lift > 0.01);
  if (lift > 0.01) rs.requestSwingLegAngle(swing, jHip, 1, 0.12, "\u6446\u52A8\u5916\u5C55", false);
  if (jSp1 >= 0) {
    const yaw = bell * 6 * D2R2 * (swing === "l" ? 1 : -1);
    rs.requestWaistSlot(jSp1, 0, yaw, "\u8FC8\u6B65\u53CD\u76F8");
  }
  if (jSp2 >= 0) rs.requestWaistSlot(jSp2, 0, rs.authority * 3 * D2R2 * (swing === "l" ? 1 : -1), "\u8FC8\u6B65\u53CD\u76F8");
  if (jSp3 >= 0) rs.requestWaistSlot(jSp3, 0, rs.authority * 2 * D2R2 * (swing === "l" ? 1 : -1), "\u8FC8\u6B65\u53CD\u76F8");
}
var KNEE_FLEX_PEAK, DEFAULT_STEP_PARAMS;
var init_step = __esm({
  "src/core/systems/step.ts"() {
    "use strict";
    init_skeleton();
    KNEE_FLEX_PEAK = 63;
    DEFAULT_STEP_PARAMS = {
      halfPeriod: 1.1,
      lift: 0.32,
      hipFlexPeakDeg: 30,
      kneeFlexPeakDeg: KNEE_FLEX_PEAK,
      liftHold: 0.25
    };
  }
});

// src/core/controller.ts
var controller_exports = {};
__export(controller_exports, {
  Controller: () => Controller,
  DEFAULT_CONTROLLER: () => DEFAULT_CONTROLLER,
  auditJoints: () => auditJoints,
  rigSummary: () => rigSummary
});
var DEFAULT_CONTROLLER, Controller, TMP_A, TMP_B, TMP_RV, TMP_COP_L, TMP_COP_R;
var init_controller = __esm({
  "src/core/controller.ts"() {
    "use strict";
    init_posture();
    init_rig();
    init_rigState();
    init_gaitState();
    init_balance2();
    init_step();
    DEFAULT_CONTROLLER = {
      rig: DEFAULT_RIGSTATE_CONFIG,
      gait: DEFAULT_GAIT_CONFIG,
      balance: DEFAULT_BALANCE_PARAMS,
      step: DEFAULT_STEP_PARAMS
    };
    Controller = class {
      constructor(sk2, sim, cfg = DEFAULT_CONTROLLER) {
        this.sim = sim;
        this.cfg = cfg;
        this.rigReport = assertRigInvariants(sk2, sim.shape);
        this.rs = new RigState(sk2, cfg.rig);
        this.gait = new GaitState(this.rs, cfg.gait);
        this.snapshot = this.rs.snapshot();
      }
      rs;
      gait;
      cfg;
      /** ★ 每拍整体替换的不可变快照。UI / 探针 / 冒烟测试只读它 */
      snapshot;
      rigReport;
      get summary() {
        return rigSummary(this.rigReport);
      }
      /** ★ 一个控制拍。返回本拍的动作目标（已仲裁）。 */
      step(dt) {
        const rs = this.rs;
        const sim = this.sim;
        rs.beginTick(dt);
        const com = readCom(sim.doll, rs.com);
        readSupport(sim.doll, rs.support);
        const om = omegaAt(com.y);
        rs.dcm.x = dcm(com.x, com.vx, om);
        rs.dcm.z = dcm(com.z, com.vz, om);
        rs.mos = rs.support.cx + rs.support.halfX - rs.dcm.x;
        const [fl, fr] = sim.doll.footLoadFrac(dt);
        rs.loadFrac.l = fl;
        rs.loadFrac.r = fr;
        rs.grounded.l = sim.doll.footGrounded(0);
        rs.grounded.r = sim.doll.footGrounded(1);
        sim.doll.soleXZ("l", TMP_A);
        rs.soleX.l = TMP_A[0];
        rs.soleZ.l = TMP_A[2];
        sim.doll.soleXZ("r", TMP_B);
        rs.soleX.r = TMP_B[0];
        rs.soleZ.r = TMP_B[2];
        const n = sim.doll.jointCount;
        for (let j = 0; j < n; j++) {
          for (let a = 0; a < 3; a++) {
            const i = j * 3 + a;
            sim.doll.jointRot(j, TMP_RV);
            rs.pos[i] = TMP_RV[a];
            sim.doll.jointRelVel(j, TMP_RV);
            rs.vel[i] = TMP_RV[a];
          }
        }
        sim.doll.readCoP(0, TMP_COP_L);
        sim.doll.readCoP(1, TMP_COP_R);
        rs.cop.l.x = TMP_COP_L[0];
        rs.cop.l.z = TMP_COP_L[2];
        rs.cop.l.load = TMP_COP_L[3];
        rs.cop.r.x = TMP_COP_R[0];
        rs.cop.r.z = TMP_COP_R[2];
        rs.cop.r.load = TMP_COP_R[3];
        rs.torsoY = sim.doll.torso().translation().y;
        rs.tiltDeg = sim.doll.tiltOf(sim.doll.torso()) * 57.2958;
        rs.grf.x = 0;
        rs.grf.y = Math.max(0.2, 686.7 * Math.max(fl, fr));
        this.gait.update(dt);
        balanceSystem(rs, this.cfg.balance);
        stepSystem(rs, this.cfg.step);
        const out = rs.arbitrate(dt);
        this.snapshot = rs.snapshot();
        return out;
      }
      /** 脚底离地高度（UI 显示用；与快照同源 —— 每次调用都回读并写进 rs） */
      soleClearance(side) {
        const y = this.sim.doll.soleY(side);
        this.rs.soleY[side] = y;
        return y;
      }
      reset() {
        this.gait.reset();
        this.rs.beginTick(0);
        this.snapshot = this.rs.snapshot();
      }
    };
    TMP_A = new Float64Array(3);
    TMP_B = new Float64Array(3);
    TMP_RV = new Float64Array(3);
    TMP_COP_L = new Float64Array(4);
    TMP_COP_R = new Float64Array(4);
  }
});

// tools/_sw.ts
init_rapier_wasm3d_bg();
import fs from "node:fs";
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);
var { buildSkeleton: buildSkeleton2, DEFAULT_CONFIG: DEFAULT_CONFIG2 } = await Promise.resolve().then(() => (init_skeleton(), skeleton_exports));
await Promise.resolve().then(() => (init_ragdoll(), ragdoll_exports));
{
  const p = require2.resolve("@dimforge/rapier3d/rapier_wasm3d_bg.wasm");
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = rapier_wasm3d_bg_exports;
  const im = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== "function") throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  __wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
var { Sim: Sim2, DEFAULT_SIM: DEFAULT_SIM2 } = await Promise.resolve().then(() => (init_sim(), sim_exports));
var { shapeForJoints: shapeForJoints2 } = await Promise.resolve().then(() => (init_brain(), brain_exports));
var { Controller: Controller2, DEFAULT_CONTROLLER: DEFAULT_CONTROLLER2 } = await Promise.resolve().then(() => (init_controller(), controller_exports));
var sk = buildSkeleton2(DEFAULT_CONFIG2);
var SHAPE = shapeForJoints2(sk.joints.length);
var DUR = 8;
var dtP = 1 / 120;
console.log("kHipAbd maxHip \u8170\u4FEE\u8FB9  \u5B58\u6D3B    \u76F8       \u8EAF\u5E72y  \u503E\xB0  \u5355\u652F\u6491% \u6446\u52A8mm \u7EC8comZ \u627F\u91CD");
for (const k of [0.3, 0.6, 1, 1.6]) for (const mx of [0.12, 0.2, 0.31]) for (const wl of [0, 0.5]) {
  const sim = new Sim2(sk, SHAPE, { ...DEFAULT_SIM2, mode: "stand", duration: DUR, driver: "controller" });
  sim.begin(new Float32Array(sim.params.length));
  const ctrl = new Controller2(sk, sim, {
    ...DEFAULT_CONTROLLER2,
    gait: { ...DEFAULT_CONTROLLER2.gait, singleLeg: "l" },
    balance: { ...DEFAULT_CONTROLLER2.balance, kHipAbd: k, maxHipAbd: mx, kWaistLat: wl }
  });
  let single = 0, n = 0, clr = 0, bearer = 0;
  for (let i = 0; i < Math.round(DUR / dtP) && !sim.finished; i++) {
    if (i % 2 === 0) {
      sim.doll.setMotorTargets(ctrl.step(1 / 60));
      ctrl.soleClearance("l");
      ctrl.soleClearance("r");
      const s2 = ctrl.snapshot;
      n++;
      if (s2.legs.l.grounded && !s2.legs.r.grounded) single++;
      if (s2.legs.r.soleY > clr) clr = s2.legs.r.soleY;
      if (s2.loadBearer) bearer++;
    }
    sim.advance(1);
  }
  const s = ctrl.snapshot, a = sim.ticksDone / 60;
  console.log(`${k.toFixed(1).padStart(6)} ${mx.toFixed(2).padStart(6)} ${wl.toFixed(1).padStart(5)}  ${(a >= DUR - 0.05 ? "\u7AD9\u6EE1" : a.toFixed(2) + "s").padStart(7)} ${s.phase.padEnd(8)} ${s.torsoY.toFixed(3)} ${s.tiltDeg.toFixed(1).padStart(5)} ${(single / n * 100).toFixed(0).padStart(6)} ${(clr * 1e3).toFixed(0).padStart(6)} ${(s.com.z * 1e3).toFixed(0).padStart(6)}  ${bearer > 0 ? "\u662F" : "\u5426"}`);
}
