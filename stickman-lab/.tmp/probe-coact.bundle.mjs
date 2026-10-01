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
function handleError(f2, args) {
  try {
    return f2.apply(this, args);
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
      forEachColliderHandle(f2) {
        try {
          wasm.rawcolliderset_forEachColliderHandle(this.__wbg_ptr, addBorrowedObject(f2));
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
      drainCollisionEvents(f2) {
        try {
          wasm.raweventqueue_drainCollisionEvents(this.__wbg_ptr, addBorrowedObject(f2));
        } finally {
          heap[stack_pointer++] = void 0;
        }
      }
      /**
      * @param {Function} f
      */
      drainContactForceEvents(f2) {
        try {
          wasm.raweventqueue_drainContactForceEvents(this.__wbg_ptr, addBorrowedObject(f2));
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
      forEachJointHandle(f2) {
        try {
          wasm.rawimpulsejointset_forEachJointHandle(this.__wbg_ptr, addBorrowedObject(f2));
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
      forEachJointAttachedToRigidBody(body, f2) {
        try {
          wasm.rawimpulsejointset_forEachJointAttachedToRigidBody(this.__wbg_ptr, body, addBorrowedObject(f2));
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
      forEachActiveRigidBodyHandle(f2) {
        try {
          wasm.rawislandmanager_forEachActiveRigidBodyHandle(this.__wbg_ptr, addBorrowedObject(f2));
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
      forEachJointHandle(f2) {
        try {
          wasm.rawmultibodyjointset_forEachJointHandle(this.__wbg_ptr, addBorrowedObject(f2));
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
      forEachJointAttachedToRigidBody(body, f2) {
        try {
          wasm.rawmultibodyjointset_forEachJointAttachedToRigidBody(this.__wbg_ptr, body, addBorrowedObject(f2));
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
      contact_pairs_with(handle1, f2) {
        wasm.rawnarrowphase_contact_pairs_with(this.__wbg_ptr, handle1, addHeapObject(f2));
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
      intersection_pairs_with(handle1, f2) {
        wasm.rawnarrowphase_intersection_pairs_with(this.__wbg_ptr, handle1, addHeapObject(f2));
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
      forEachRigidBodyHandle(f2) {
        try {
          wasm.rawrigidbodyset_forEachRigidBodyHandle(this.__wbg_ptr, addBorrowedObject(f2));
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
var ANKLE_JOINTS, meta, META, PART_BY_KEY, LIMB_AXES;
var init_partsMeta = __esm({
  "src/core/partsMeta.ts"() {
    "use strict";
    init_parts();
    init_limbAxes();
    ANKLE_JOINTS = [
      { name: "foot_l", parent: "shin_l", child: "foot_l", x: 454.5, y: 2792, limitDeg: [-10, 18] },
      { name: "foot_r", parent: "shin_r", child: "foot_r", x: 1110.5, y: 2792, limitDeg: [-10, 18] }
    ];
    meta = parts_default;
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
  invQuatOf: () => invQuatOf,
  quatToRotVec: () => quatToRotVec,
  restQuatOf: () => restQuatOf,
  restVisualQuatOf: () => restVisualQuatOf,
  rotVecByQuat: () => rotVecByQuat
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
  const CHEST2 = K > 1 ? `spine${K}` : "torso";
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
      // 踝：X/Y（外展·内外翻）只给 ±8°，踝的侧向自由度不是走路的主自由度，
      //   放开会让脚掌乱翻、把支撑面搞丢。
      foot_l: [8, 6],
      foot_r: [8, 6]
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
      forEach(f2) {
        for (const elt of this.data) {
          if (elt != null)
            f2(elt);
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
      forEach(f2) {
        this.map.forEach(f2);
      }
      /**
       * Applies the given closure to each active rigid-bodies contained by this set.
       *
       * A rigid-body is active if it is not sleeping, i.e., if it moved recently.
       *
       * @param f - The closure to apply.
       */
      forEachActiveRigidBody(islands, f2) {
        islands.forEachActiveRigidBodyHandle((handle) => {
          f2(this.get(handle));
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
      forEachJointHandleAttachedToRigidBody(handle, f2) {
        this.raw.forEachJointAttachedToRigidBody(handle, f2);
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
      forEach(f2) {
        this.map.forEach(f2);
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
      forEach(f2) {
        this.map.forEach(f2);
      }
      /**
       * Calls the given closure with the integer handle of each multibody joint attached to this rigid-body.
       *
       * @param f - The closure called with the integer handle of each multibody joint attached to the rigid-body.
       */
      forEachJointHandleAttachedToRigidBody(handle, f2) {
        this.raw.forEachJointAttachedToRigidBody(handle, f2);
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
      forEachActiveRigidBodyHandle(f2) {
        this.raw.forEachActiveRigidBodyHandle(f2);
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
      contactPairsWith(collider1, f2) {
        this.raw.contact_pairs_with(collider1, f2);
      }
      /**
       * Enumerates all the colliders intersecting the given colliders, assuming one of them
       * is a sensor.
       */
      intersectionPairsWith(collider1, f2) {
        this.raw.intersection_pairs_with(collider1, f2);
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
      contactPair(collider1, collider2, f2) {
        const rawPair = this.raw.contact_pair(collider1, collider2);
        if (!!rawPair) {
          const flipped = rawPair.collider1() != collider1;
          let i;
          for (i = 0; i < rawPair.numContactManifolds(); ++i) {
            this.tempManifold.raw = rawPair.contactManifold(i);
            if (!!this.tempManifold.raw) {
              f2(this.tempManifold, flipped);
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
      forEachCollider(f2) {
        this.colliders.forEach(f2);
      }
      /**
       * Applies the given closure to each rigid-body managed by this physics world.
       *
       * @param f(body) - The function to apply to each rigid-body managed by this physics world. Called as `f(collider)`.
       */
      forEachRigidBody(f2) {
        this.bodies.forEach(f2);
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
      forEachActiveRigidBody(f2) {
        this.bodies.forEachActiveRigidBody(this.islands, f2);
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
      contactPairsWith(collider1, f2) {
        this.narrowPhase.contactPairsWith(collider1.handle, this.colliders.castClosure(f2));
      }
      /**
       * Enumerates all the colliders intersecting the given colliders, assuming one of them
       * is a sensor.
       */
      intersectionPairsWith(collider1, f2) {
        this.narrowPhase.intersectionPairsWith(collider1.handle, this.colliders.castClosure(f2));
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
      contactPair(collider1, collider2, f2) {
        this.narrowPhase.contactPair(collider1.handle, collider2.handle, f2);
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
      drainCollisionEvents(f2) {
        this.raw.drainCollisionEvents(f2);
      }
      /**
       * Applies the given javascript closure on each contact force event of this collector, then clear
       * the internal collision event buffer.
       *
       * @param f - JavaScript closure applied to each collision event. The
       *            closure must take one `TempContactForceEvent` argument.
       */
      drainContactForceEvents(f2) {
        let event = new TempContactForceEvent();
        this.raw.drainContactForceEvents((raw) => {
          event.raw = raw;
          f2(event);
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
      castClosure(f2) {
        return (handle) => {
          if (!!f2) {
            return f2(this.get(handle));
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
      forEach(f2) {
        this.map.forEach(f2);
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
var rapier_exports = {};
__export(rapier_exports, {
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
  default: () => rapier_default,
  version: () => version2
});
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
function quatRel2(ax, ay, az, aw, bx, by2, bz, bw, out) {
  const cx = -ax, cy = -ay, cz = -az, cw = aw;
  out[0] = cw * bx + cx * bw + cy * bz - cz * by2;
  out[1] = cw * by2 - cx * bz + cy * bw + cz * bx;
  out[2] = cw * bz + cx * by2 - cy * bx + cz * bw;
  out[3] = cw * bw - cx * bx - cy * by2 - cz * bz;
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
      posRefScale: 0.9,
      purgeJointCache: true,
      motorAlpha: MOTOR_ALPHA
    };
    Ragdoll = class {
      sk;
      opt;
      bodies = [];
      /** [左, 右] 鞋底 collider（腾空时间/单脚支撑的真实接触判据） */
      soleCol = [null, null];
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
          bodyI[i] = Math.max(1e-6, Math.min(I.x, I.y, I.z));
        }
        for (let i = 0; i < sk2.joints.length; i++) {
          const ip = bodyI[this.jointBodies[i * 2]];
          const ic = bodyI[this.jointBodies[i * 2 + 1]];
          this.jointIeff[i] = 1 / (1 / ip + 1 / ic);
        }
        this.refPos = new Float64Array(sk2.joints.length * 3);
        this.refNeg = new Float64Array(sk2.joints.length * 3);
        for (let i = 0; i < sk2.joints.length; i++) {
          for (let k = 0; k < 3; k++) {
            const s = this.opt.posRefScale;
            this.refPos[i * 3 + k] = s * Math.max(0, sk2.joints[i].maxRad[k]);
            this.refNeg[i * 3 + k] = s * Math.max(0, -sk2.joints[i].minRad[k]);
          }
        }
      }
      /**
       * 建/重建所有关节。
       * 球关节只有两个锚点参数，没有轴、没有限位 —— 限位和马达全在 driveMotors 里。
       */
      createJoints() {
        this.joints.length = 0;
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
      bodyHitGround() {
        for (let i = 0; i < this.bodies.length; i++) {
          const bd = this.sk.bodies[i];
          if (bd.key === "shin_l" || bd.key === "shin_r" || bd.key === "foot_l" || bd.key === "foot_r") continue;
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
            if (hit) return true;
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
        const kP = this.opt.kP;
        const kD = this.opt.kD;
        const qRel = this.qRel;
        const rv = this.rv;
        const relL = this.relL;
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
          const Ieff = this.jointIeff[i];
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
              err = kP * (thRef - a) - kD * relL[k];
            }
            if (err === 0) continue;
            const tauMax = j.maxTorque[k] * scale;
            let tau = err * (tauMax / JOINT_MAX_SPEED);
            if (tau > tauMax) tau = tauMax;
            else if (tau < -tauMax) tau = -tauMax;
            this.motorDemand[idx] = tau;
            let imp = tau * dt;
            const impStable = alpha * Math.abs(err) * Ieff;
            if (imp > impStable) imp = impStable;
            else if (imp < -impStable) imp = -impStable;
            if (imp === 0) continue;
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
        }
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
        const key = side === "l" ? "shin_l" : "shin_r";
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
      footTmp = new Float64Array(3);
      /** 脚掌最低点的世界 y（接地代理量，比接触查询便宜） */
      soleY(side) {
        this.footPoint(side, this.footTmp);
        return this.footTmp[1];
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

// src/core/posture.ts
var posture_exports = {};
__export(posture_exports, {
  CONTACT_Y: () => CONTACT_Y,
  GRAVITY_Y: () => GRAVITY_Y,
  dcm: () => dcm,
  dcmExcess: () => dcmExcess,
  footGrounded: () => footGrounded,
  newCom: () => newCom,
  newSupport: () => newSupport,
  omegaAt: () => omegaAt,
  readCom: () => readCom,
  readSupport: () => readSupport
});
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

// tools/probe-coact.ts
init_rapier_wasm3d_bg();
import fs from "node:fs";
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);
var { buildSkeleton: buildSkeleton2, DEFAULT_CONFIG: DEFAULT_CONFIG2 } = await Promise.resolve().then(() => (init_skeleton(), skeleton_exports));
var { Ragdoll: Ragdoll2 } = await Promise.resolve().then(() => (init_ragdoll(), ragdoll_exports));
var P = await Promise.resolve().then(() => (init_posture(), posture_exports));
{
  const wasmPath = require2.resolve("@dimforge/rapier3d/rapier_wasm3d_bg.wasm");
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = rapier_wasm3d_bg_exports;
  const imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== "function") throw new Error(`[probe-coact] wasm \u5BFC\u5165\u7F3A\u5931 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  __wbg_set_wasm(instance.exports);
}
var RAPIER = (await Promise.resolve().then(() => (init_rapier(), rapier_exports))).default;
var sk = buildSkeleton2(DEFAULT_CONFIG2);
var DT = 1 / 120;
var G = 9.81;
var NW = sk.massTotal * G;
var log = (...a) => console.log(...a);
var f = (x, n = 3) => Number.isFinite(x) ? x.toFixed(n) : "NaN";
var line = (n = 108) => "\u2500".repeat(n);
var HZ = 0.063;
var HX = 0.11;
var idxOf = (key) => sk.bodies.findIndex((b) => b.key === key);
var jointParent = [];
var jointChild = [];
for (const j of sk.joints) {
  jointParent.push(idxOf(j.parentKey));
  jointChild.push(idxOf(j.childKey));
}
function subtreeOf(j) {
  const out = [];
  const stack = [jointChild[j]];
  while (stack.length) {
    const b = stack.pop();
    out.push(b);
    for (let k = 0; k < sk.joints.length; k++) if (jointParent[k] === b) stack.push(jointChild[k]);
  }
  return out;
}
var SUB_L = subtreeOf(sk.joints.findIndex((j) => j.name === "hip_l"));
var SUB_R = subtreeOf(sk.joints.findIndex((j) => j.name === "hip_r"));
var CHEST = idxOf("spine4");
var SPINE = sk.joints.map((j, i) => [j.name, i]).filter(([n]) => n.startsWith("spine")).map(([, i]) => i);
var mk = (o) => new Map(Object.entries(o).map(([k, v]) => [k, v]));
var rep = (joints, axis, v, o) => {
  for (const j of joints) o.set(`${j}:${axis}`, v);
  return o;
};
var ALL = sk.joints.map((j) => j.name);
var SPINE_N = ALL.filter((n) => n.startsWith("spine"));
var HIP_N = ALL.filter((n) => n.startsWith("hip"));
var KNEE_N = ALL.filter((n) => n.startsWith("knee"));
var SH_N = ALL.filter((n) => n.startsWith("shoulder"));
var merge = (...cs) => {
  const out = /* @__PURE__ */ new Map();
  for (const c of cs) for (const [k, v] of c) out.set(k, v);
  return out;
};
var CHANNELS = [
  { name: "zero", note: "\u57FA\u7EBF\uFF1A\u5168 0 = \u4FDD\u6301\u7ED1\u5B9A\u59FF\u6001", cmd: mk({}) },
  { name: "waist-lat", note: "\u8170\u4FA7\u503E 0.8\uFF08\u03B8_ref \u2248 10.8\xB0\uFF0C\u9650\u4F4D \xB115\xB0\uFF09", cmd: rep(SPINE_N, 0, 0.8, mk({})) },
  { name: "waist-pitch", note: "\u8170\u524D\u5C48 0.5\uFF08\u03B8_ref \u2248 11\xB0\uFF0C\u9650\u4F4D \xB125\xB0\uFF09", cmd: rep(SPINE_N, 2, -0.5, mk({})) },
  { name: "squat-soft", note: "\u5FAE\u8E72 0.10\uFF08\u819D \u03B8_ref \u2248 \u221213\xB0\uFF1B**\u6D3B\u5F97\u4E0B\u6765**\u624D\u80FD\u91CF\u524D\u540E CoP\uFF09", cmd: rep([...HIP_N, ...KNEE_N], 2, -0.1, mk({})) },
  { name: "squat", note: "\u7F13\u8E72 0.25\uFF08\u819D \u03B8_ref \u2248 \u221233\xB0\uFF1B\u524D\u540E CoP \u901A\u9053\uFF09", cmd: rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({})) },
  { name: "lift-left", note: "\u53EA\u62AC\u5DE6\u9ACB\u5916\u5C55 0.8\uFF08\u6362\u652F\u6491\uFF0C\u65E0\u8E1D \u21D2 \u4E0D\u632A CoP\uFF09", cmd: mk({ "hip_l:0": 0.8 }) },
  { name: "arms-lat", note: "\u53CC\u81C2\u5916\u5C55 0.8\uFF08\u03B8_ref \u2248 54\xB0\uFF0C\u9650\u4F4D \xB175\xB0\uFF09", cmd: rep(SH_N, 0, 0.8, mk({})) },
  { name: "arms-fwd", note: "\u53CC\u81C2\u524D\u6446 0.5\uFF08\u524D\u540E\u914D\u91CD\uFF09", cmd: rep(SH_N, 2, 0.5, mk({})) },
  { name: "arms-asym", note: "\u2605 \u53EA\u62AC**\u5DE6**\u81C2\u5916\u5C55 0.8\uFF08\u5BF9\u79F0\u5916\u5C55\u5BF9\u4FA7\u5411 CoM \u4E00\u9636\u96F6\u8D21\u732E \u21D2 \u5FC5\u987B\u4E0D\u5BF9\u79F0\u7528\uFF09", cmd: mk({ "shoulder_l:0": 0.8 }) },
  { name: "squat-coop", note: "\u2605\u2605 \u534F\u8C03\u8E72\uFF1A\u9ACB \u22120.10 / \u819D \u22120.15 / **\u8170 +0.10 \u53CD\u5411\u914D\u5E73**\uFF08\u8EAF\u5E72\u4FDD\u6301\u76F4\u7ACB\uFF09", cmd: merge(rep(HIP_N, 2, -0.1, mk({})), rep(KNEE_N, 2, -0.15, mk({})), rep(SPINE_N, 2, 0.1, mk({}))) },
  { name: "waist+legs", note: "\u2605\u2605 \u8170\u4FA7\u503E + \u7F13\u8E72\uFF08\u7528\u6237\u4E3B\u95EE\u9898\uFF1A\u8170\u817F\u540C\u65F6\uFF09", cmd: merge(rep(SPINE_N, 0, 0.8, mk({})), rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({}))) },
  { name: "waist+legs+arms", note: "\u2605\u2605\u2605 \u8170 + \u817F + \u80F3\u818A\u540C\u65F6\u53D1\u529B", cmd: merge(rep(SPINE_N, 0, 0.8, mk({})), rep(SH_N, 0, 0.8, mk({})), rep([...HIP_N, ...KNEE_N], 2, -0.25, mk({}))) }
];
function footContact(world, doll, side) {
  const idx = idxOf(`foot_${side}`);
  const b = doll.bodies[idx];
  let fy = 0, sx = 0, sz = 0;
  for (let ci = 0; ci < b.numColliders(); ci++) {
    const col = b.collider(ci);
    world.contactPairsWith(col, (other) => {
      world.contactPair(col, other, (mf) => {
        const nY = mf.normal().y;
        for (let k = 0; k < mf.numContacts(); k++) {
          const w = Math.abs(nY * mf.contactImpulse(k)) / DT;
          if (w === 0) continue;
          const p = mf.solverContactPoint(k);
          fy += w;
          sx += p.x * w;
          sz += p.z * w;
        }
      });
    });
  }
  return { fy, cx: fy !== 0 ? sx / fy : 0, cz: fy !== 0 ? sz / fy : 0 };
}
function measure(ch) {
  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll2(world, sk, {});
  doll.reset(0);
  const target = new Float32Array(doll.jointCount * 3);
  const fill = (scale) => {
    target.fill(0);
    for (let j = 0; j < sk.joints.length; j++) {
      for (let a = 0; a < 3; a++) {
        const v = ch.cmd.get(`${sk.joints[j].name}:${a}`);
        if (v) target[j * 3 + a] = v * scale;
      }
    }
  };
  const com = P.newCom();
  const sup = P.newSupport();
  const RAMP0 = 0.8, RAMP1 = 1.2, WIN0 = 2.2, WIN1 = 3.2, T_END = 3.4;
  const y0 = doll.bodies[CHEST].translation().y;
  let t = 0, nWin = 0, fell = false, fallT = null;
  let fallXiX = 0, fallXiZ = 0;
  let sComZ = 0, sXiZ = 0, sEZ = 0, sMarP = 0, sMarM = 0, sCoPz = 0, sComX = 0, sXiX = 0, sCoPx = 0, sAsym = 0;
  let sTau = 0, sY = 0, sGround = 0, sFeet = 0;
  let legSat = 0, armSat = 0, waistSat = 0, maxSat = 0, maxSatName = "", jitter = 0;
  const prevTau = new Float64Array(doll.jointCount * 3);
  let primed = false;
  while (t < T_END) {
    const s = t < RAMP0 ? 0 : t < RAMP1 ? (t - RAMP0) / (RAMP1 - RAMP0) : 1;
    fill(s);
    doll.setMotorTargets(target);
    doll.driveMotors(DT);
    world.step();
    t += DT;
    const inWin = t >= WIN0 && t <= WIN1;
    let tauAbs = 0;
    for (let j = 0; j < sk.joints.length; j++) {
      const nm = sk.joints[j].name;
      const grp = nm.startsWith("hip") || nm.startsWith("knee") ? 1 : nm.startsWith("shoulder") || nm.startsWith("elbow") ? 2 : nm.startsWith("spine") ? 3 : 0;
      for (let a = 0; a < 3; a++) {
        const k = j * 3 + a;
        const tau = doll.motorImpulse[k] / DT;
        tauAbs += Math.abs(tau);
        if (primed && t > RAMP1) jitter += (tau - prevTau[k]) ** 2;
        prevTau[k] = tau;
        if (inWin) {
          const sat = Math.abs(tau) / sk.joints[j].maxTorque[a];
          if (grp === 1 && sat > legSat) legSat = sat;
          if (grp === 2 && sat > armSat) armSat = sat;
          if (grp === 3 && sat > waistSat) waistSat = sat;
          if (sat > maxSat) {
            maxSat = sat;
            maxSatName = `${nm}.${["\u5916\u5C55", "\u626D\u8F6C", "\u5C48\u4F38"][a]}`;
          }
        }
      }
    }
    primed = true;
    const cl = footContact(world, doll, "l");
    const cr = footContact(world, doll, "r");
    const nl = cl.fy, nr = cr.fy;
    const chest = doll.bodies[CHEST].translation().y;
    if (!fell && (chest < y0 * 0.62 || doll.tiltOf(doll.torso()) > 1.25)) {
      fell = true;
      fallT = t;
      P.readCom(doll, com);
      P.readSupport(doll, sup);
      const wf = P.omegaAt(com.y);
      fallXiX = (P.dcm(com.x, com.vx, wf) - sup.cx) / sup.halfX;
      fallXiZ = (P.dcm(com.z, com.vz, wf) - sup.cz) / sup.halfZ;
    }
    if (inWin && !fell) {
      P.readCom(doll, com);
      P.readSupport(doll, sup);
      const w = P.omegaAt(com.y);
      const xiZ = P.dcm(com.z, com.vz, w);
      const xiX = P.dcm(com.x, com.vx, w);
      sComZ += com.z - sup.cz;
      sXiZ += xiZ - sup.cz;
      sEZ += P.dcmExcess(xiZ, sup.cz, sup.halfZ);
      sMarP += sup.halfZ - (xiZ - sup.cz);
      sMarM += sup.halfZ + (xiZ - sup.cz);
      sComX += com.x - sup.cx;
      sXiX += xiX - sup.cx;
      sGround += (nl + nr) / NW;
      sFeet += sup.contactN;
      if (nl + nr > 0.5 * NW) {
        sCoPz += (nl * cl.cz + nr * cr.cz) / (nl + nr) - sup.cz;
        sCoPx += (nl * cl.cx + nr * cr.cx) / (nl + nr) - sup.cx;
        sAsym += (nr - nl) / (nl + nr);
      }
      sTau += tauAbs;
      sY += chest;
      nWin++;
    }
  }
  world.free();
  const inv = 1 / Math.max(1, nWin);
  return {
    name: ch.name,
    note: ch.note,
    fell,
    fallT,
    fallXiX,
    fallXiZ,
    grounded: sGround * inv,
    feet: sFeet * inv,
    dComZ: sComZ * inv,
    dXiZ: sXiZ * inv,
    eZ: sEZ * inv,
    marP: sMarP * inv,
    marM: sMarM * inv,
    dCoPz: sCoPz * inv,
    dComX: sComX * inv,
    dXiX: sXiX * inv,
    dCoPx: sCoPx * inv,
    asym: sAsym * inv,
    legSat,
    armSat,
    waistSat,
    maxSat,
    maxSatName,
    tauInt: sTau * inv,
    jitter,
    chestY: sY * inv
  };
}
var rows = CHANNELS.map(measure);
var by = (n) => rows.find((r) => r.name === n);
var st = (r) => r.fell ? `\u2718 \u5012 @${r.fallT.toFixed(2)}s\uFF08\u03BE\u8D8A\u754C ${Math.abs(r.fallXiX) >= Math.abs(r.fallXiZ) ? "\u524D\u540E" : "\u4FA7\u5411"} ${f(Math.max(Math.abs(r.fallXiX), Math.abs(r.fallXiZ)), 1)}\xD7\uFF09` : r.eZ > 1 ? "\u2718 \u8D8A\u754C" : "\u2714 \u57DF\u5185";
log("");
log(line());
log("  probe-coact \u2014\u2014 \u5206\u901A\u9053\u7A33\u5B9A\u6743\u9650\u56DE\u8BFB\uFF08\u8170 / \u817F / \u80F3\u818A\uFF09");
log(`  \u786C\u4EF6 kP = 48 / \u03B1 = 1.0\uFF08\u9ED8\u8BA4\uFF09\uFF1B\u4F53\u91CD ${NW.toFixed(0)} N\uFF1B\u51C6\u9759\u6001\u7A97\u53E3 2.2\u20133.2 s\uFF1B\u88AB\u52A8\u534A\u5BBD \u4FA7\u5411 ${f(HZ)} m / \u524D\u540E ${f(HX)} m`);
log(line());
log("  \u2605 \u7A33\u5B9A\u6027\u53EA\u770B\u6355\u83B7\u70B9 \u03BE = x + \u1E8B/\u03C9\u3002\u5173\u8282\u529B\u77E9\u662F\u5185\u529B\u5BF9\u3001\u8FDB\u4E0D\u4E86 \u03BE\uFF1B\u80FD\u8FDB \u03BE \u7684\u53EA\u6709");
log("    **\u642C CoP**\uFF08\u53EA\u6709\u811A \u21D2 \u817F\u7684\u6D3B\uFF09\u4E0E **\u642C CoM**\uFF08\u8170/\u80F3\u818A\u7684\u6D3B\uFF09\u3002");
log("  \u2605 \u65E0\u8E1D\u5173\u8282 \u21D2 \u4FA7\u5411 CoP \u4E0D\u53EF\u76F4\u63A5\u63A7\uFF08\u9ACB\u5916\u5C55=\u6362\u652F\u6491\uFF09\uFF0C\u4FA7\u5411\u5E73\u8861\u53EA\u80FD\u642C CoM \u6216\u8FC8\u6B65\u3002");
log("");
log("  \u3010\u88681\u3011\u4FA7\u5411\uFF1A\u03BE \u6743\u9650\u4E0E\u4F59\u91CF\u642C\u79FB\uFF08+Z \u4E3A\u6B63\uFF1B\u4F59\u91CF = \u79BB\u51FA\u754C\u8FD8\u591A\u8FDC\uFF09");
log("  " + line());
log("  " + "\u901A\u9053".padEnd(20) + "\u0394CoM_z".padStart(9) + "\u0394\u03BE_z".padStart(9) + "\xD7\u534A\u5BBD".padStart(8) + "\u4F59\u91CF+".padStart(9) + "\u4F59\u91CF\u2212".padStart(9) + "\u0394CoP_z".padStart(9) + "\u8F7D\u8377\u5DEE".padStart(8) + "\u817F\u9971\u548C".padStart(8) + "\u8170\u9971\u548C".padStart(8) + "\u81C2\u9971\u548C".padStart(8) + "\u222B\u03A3|\u03C4|dt".padStart(10) + "\u6296\u52A8".padStart(9) + "\u72B6\u6001");
log("  " + line());
for (const r of rows) {
  log("  " + r.name.padEnd(20) + f(r.dComZ, 4).padStart(9) + f(r.dXiZ, 4).padStart(9) + f(Math.abs(r.dXiZ) / HZ, 2).padStart(8) + f(r.marP, 4).padStart(9) + f(r.marM, 4).padStart(9) + f(r.dCoPz, 4).padStart(9) + `${(r.asym * 100).toFixed(0)}%`.padStart(8) + `${(r.legSat * 100).toFixed(0)}%`.padStart(8) + `${(r.waistSat * 100).toFixed(0)}%`.padStart(8) + `${(r.armSat * 100).toFixed(0)}%`.padStart(8) + r.tauInt.toFixed(0).padStart(10) + r.jitter.toExponential(1).padStart(9) + "  " + st(r));
}
log("  " + line());
log("  \u3010\u88682\u3011\u524D\u540E\uFF08X\uFF09\uFF1A\u817F\u80FD\u4E0D\u80FD\u642C CoP");
log("  " + line());
log("  " + "\u901A\u9053".padEnd(20) + "\u0394CoM_x".padStart(9) + "\u0394\u03BE_x".padStart(9) + "\u0394CoP_x".padStart(9) + "\u652F\u6491\u811A".padStart(8) + "\u72B6\u6001");
log("  " + line());
for (const r of rows) log("  " + r.name.padEnd(20) + f(r.dComX, 4).padStart(9) + f(r.dXiX, 4).padStart(9) + f(r.dCoPx, 4).padStart(9) + f(r.feet, 2).padStart(8) + "  " + st(r));
log("  " + line());
log("");
log('  \u3010\u88683\u3011\u6743\u9650\u66F2\u7EBF\uFF1A\u547D\u4EE4\u5E45\u503C \u2192 \u03BE \u4F4D\u79FB / \u5B58\u6D3B\uFF08\u627E\u51FA"\u4E0D\u51FA\u754C\u524D\u63D0\u4E0B\u7684\u6700\u5927\u53EF\u7528\u6743\u9650"\uFF09');
log("  " + line());
log("  " + "\u901A\u9053".padEnd(16) + "\u5E45\u503C".padStart(6) + "\u0394\u03BE_z(m)".padStart(10) + "\xD7\u534A\u5BBD".padStart(8) + "\u5012/\u5B58\u6D3B".padStart(12));
log("  " + line());
var sweep = [];
var SWEEP_SETS = [
  ["waist-lat", rep(SPINE_N, 0, 1, mk({}))],
  ["arms-lat", rep(SH_N, 0, 1, mk({}))],
  ["arms-asym", mk({ "shoulder_l:0": 1 })],
  ["lift-left", mk({ "hip_l:0": 1 })]
];
for (const [label, proto] of SWEEP_SETS) {
  for (const amp of [0.15, 0.3, 0.45, 0.6, 0.8]) {
    const c = { name: `${label}@${amp}`, note: "", cmd: new Map([...proto].map(([k, v]) => [k, v * amp])) };
    const r = measure(c);
    sweep.push({ ch: label, amp, dXi: r.dXiZ, fell: r.fell, fallT: r.fallT, sat: r.maxSat });
    log("  " + `${label}`.padEnd(16) + amp.toFixed(2).padStart(6) + f(r.dXiZ, 4).padStart(10) + f(Math.abs(r.dXiZ) / HZ, 2).padStart(8) + (r.fell ? `  \u2718 \u5012 @${r.fallT.toFixed(2)}s` : `  \u2714 \u5B58\u6D3B  \u5CF0\u9971\u548C ${(r.maxSat * 100).toFixed(0)}%`));
  }
}
log("  " + line());
var safeOf = (ch) => {
  const ok = sweep.filter((s) => s.ch === ch && !s.fell);
  return ok.length ? Math.abs(ok[ok.length - 1].dXi) : 0;
};
var lastOf = (ch) => {
  const ok = sweep.filter((s) => s.ch === ch && !s.fell);
  return ok.length ? Math.abs(ok[ok.length - 1].amp) : 0;
};
var safeWaist = safeOf("waist-lat");
var safeArmsSym = safeOf("arms-lat");
var safeArmsAsym = safeOf("arms-asym");
var safeLift = safeOf("lift-left");
log("  \u21D2 \u4E0D\u51FA\u754C\u524D\u63D0\u4E0B\u7684**\u5B89\u5168\u6743\u9650**\uFF08\u4FA7\u5411 \u03BE \u4F4D\u79FB\uFF0Cm\uFF09\uFF1A");
log(`     \u8170\u4FA7\u503E        ${f(safeWaist, 4)}\uFF08${f(safeWaist / HZ, 2)}\xD7 \u534A\u5BBD\uFF0C\u5B58\u6D3B\u5230\u5E45\u503C ${lastOf("waist-lat").toFixed(2)}\uFF09`);
log(`     \u53CC\u81C2\u5BF9\u79F0\u5916\u5C55  ${f(safeArmsSym, 4)}\uFF08${f(safeArmsSym / HZ, 2)}\xD7\uFF0C\u5B58\u6D3B\u5230\u5E45\u503C ${lastOf("arms-lat").toFixed(2)}\uFF09  \u2190 \u5DE6\u53F3\u62B5\u6D88\uFF0C\u53EA\u5269\u4E8C\u9636`);
log(`     \u5355\u81C2\u5916\u5C55      ${f(safeArmsAsym, 4)}\uFF08${f(safeArmsAsym / HZ, 2)}\xD7\uFF0C\u5B58\u6D3B\u5230\u5E45\u503C ${lastOf("arms-asym").toFixed(2)}\uFF09  \u2190 \u4E0D\u5BF9\u79F0\u624D\u6709\u771F\u6743\u9650`);
log(`     \u5355\u817F\u62AC\u8D77      ${f(safeLift, 4)}\uFF08${f(safeLift / HZ, 2)}\xD7\uFF0C\u5B58\u6D3B\u5230\u5E45\u503C ${lastOf("lift-left").toFixed(2)}\uFF09`);
log("");
var failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}
var base = by("zero");
var waist = by("waist-lat");
var armsSym = by("arms-lat");
var armsAsym = by("arms-asym");
var squatSoft = by("squat-soft");
var lift = by("lift-left");
var wl = by("waist+legs");
var wla = by("waist+legs+arms");
log(line());
log("  \u5224\u636E\uFF08\u2605 \u591A\u6761\u662F**\u8BC1\u4F2A**\u76F4\u89C9\u7684\uFF1A\u628A\u7ED3\u8BBA\u9489\u6210\u65AD\u8A00\uFF0C\u514D\u5F97\u4E0B\u6B21\u6539\u56DE\u53BB\uFF09");
log(line());
check(
  "A1 \u57FA\u7EBF\u81EA\u68C0\uFF1A\u96F6\u547D\u4EE4\u7AD9\u5728\u88AB\u52A8\u57DF\u5185\u3001\u6CA1\u5012\uFF0C\u63A5\u5730\u7387 \u2248 1\u3001\u652F\u6491\u811A = 2\uFF08\u529B\u8BFB\u6570\u53EF\u4FE1\uFF09",
  !base.fell && base.eZ <= 1 && Math.abs(base.grounded - 1) < 0.15 && Math.abs(base.feet - 2) < 0.2,
  `e_z = ${f(base.eZ)}  \u4F59\u91CF ${f(base.marP, 4)}/${f(base.marM, 4)} m  \u63A5\u5730\u7387 ${f(base.grounded, 2)}  \u652F\u6491\u811A ${f(base.feet, 1)}  \u8F7D\u8377\u5DEE ${(base.asym * 100).toFixed(0)}%`
);
check(
  'A2 \u2605\u2605 \u6267\u884C\u5668\u6743\u9650**\u8FDC\u672A\u7528\u6EE1**\uFF08\u4E0D\u662F"\u529B\u4E0D\u591F"\uFF09\uFF1A\u7AD9\u6869\u65F6\u817F/\u81C2\u9971\u548C\u7387\u90FD \u2264 25%',
  base.legSat <= 0.25 && base.armSat <= 0.25,
  `\u817F ${(base.legSat * 100).toFixed(0)}%   \u81C2 ${(base.armSat * 100).toFixed(0)}%   \u8170 ${(base.waistSat * 100).toFixed(0)}%   \u6700\u5403\u529B ${base.maxSatName}`
);
check(
  "A3 \u2605\u2605\u2605 **\u8170\u6781\u7075\u654F**\uFF1A\u4FA7\u503E 2\xB0\uFF08\u5E45\u503C 0.15\uFF09\u5C31\u5403\u6389 \u22651/4 \u4E2A\u88AB\u52A8\u4FA7\u5411\u57DF\uFF1B\u5927\u5E45\u503C\u76F4\u63A5\u5012",
  safeWaist >= 0.22 * HZ && waist.fell,
  `\u5E45\u503C 0.15 \u2192 \u0394\u03BE_z = ${f(safeWaist, 4)} m\uFF08${f(safeWaist / HZ, 2)}\xD7\uFF0C\u5B58\u6D3B\uFF09\uFF1B\u5E45\u503C 0.8 \u2192 ${st(waist)}`
);
check(
  "A4 \u8170\u4ECD\u6709**\u53EF\u7528**\u7684\u5B89\u5168\u6743\u9650\uFF08\u22650.25\xD7 \u534A\u5BBD\uFF09\u21D2 \u53CD\u9988\u56DE\u8DEF\u6709\u6267\u884C\u5668\u53EF\u7528",
  safeWaist >= 0.25 * HZ,
  `\u5B89\u5168\u6743\u9650 ${f(safeWaist, 4)} m = ${f(safeWaist / HZ, 2)}\xD7 \u534A\u5BBD`
);
var effArms = Math.abs(armsSym.dXiZ) / Math.max(1e-9, armsSym.armSat);
var effLift = Math.abs(lift.dXiZ) / Math.max(1e-9, lift.legSat);
check(
  "A5 \u2605\u2605 \u80F3\u818A\u662F**\u4F4E\u4EE3\u4EF7\u7CBE\u8C03\u901A\u9053**\uFF08\u5355\u4F4D\u9971\u548C\u6362\u5230\u7684 \u03BE \u4F4D\u79FB\u6700\u5927\uFF09\uFF1A\u6027\u4EF7\u6BD4 > \u62AC\u817F",
  armsSym.armSat > 0 && effArms > effLift,
  `\u80F3\u818A ${f(Math.abs(armsSym.dXiZ), 4)} m @\u81C2${(armsSym.armSat * 100).toFixed(0)}% \u21D2 ${f(effArms * 100, 2)} m/100%   \u62AC\u817F ${f(Math.abs(lift.dXiZ), 4)} m @\u817F${(lift.legSat * 100).toFixed(0)}% \u21D2 ${f(effLift * 100, 2)} m/100%`
);
check(
  'A6 \u2605 \u65E0\u8E1D \u21D2 \u62AC\u817F\u662F"\u6362\u652F\u6491"\uFF1ACoP \u88AB**\u52A8**\u642C\u8D70\uFF08\u5DEE\u52A8\u5378\u8F7D\uFF09\uFF0C\u4F46\u652F\u6491\u57DF\u540C\u65F6**\u53D8\u7A84** \u21D2 \u4E0D\u662F\u514D\u8D39\u6743\u9650',
  !lift.fell && Math.abs(lift.dCoPz) > 0.01 && lift.marP < base.marP * 0.95,
  `\u62AC\u5DE6\u817F \u0394CoP_z = ${f(lift.dCoPz, 4)} m\uFF08\u8F7D\u8377\u5DEE ${(lift.asym * 100).toFixed(0)}%\uFF09  \u4F59\u91CF+ ${f(lift.marP, 4)} vs \u57FA\u7EBF ${f(base.marP, 4)} m\uFF08${f(lift.marP / base.marP, 2)}\xD7\uFF09`
);
var fellSquat = ["squat-soft", "squat", "squat-coop", "waist-pitch"].filter((n) => by(n).fell).length;
check(
  "A7 \u2605\u2605\u2605 **\u7ED1\u5B9A\u59FF\u6001\u662F\u552F\u4E00\u9759\u5E73\u8861\u70B9**\uFF1A\u4EFB\u4F55\u6301\u7EED\u7684\u5C48\u819D/\u5C48\u8170\u59FF\u52BF\u504F\u79FB\u90FD\u4F1A\u5012\uFF084 \u4E2A\u901A\u9053\u5168\u5012\uFF09",
  fellSquat === 4,
  `\u5FAE\u8E72 ${st(by("squat-soft"))}   \u7F13\u8E72 ${st(by("squat"))}   \u534F\u8C03\u8E72 ${st(by("squat-coop"))}   \u8170\u524D\u5C48 ${st(by("waist-pitch"))}`
);
var tW = waist.fallT ?? Infinity;
var tWL = wl.fell ? wl.fallT : Infinity;
var tWLA = wla.fell ? wla.fallT : Infinity;
check(
  'A8 \u2605\u2605\u2605 **\u8BC1\u4F2A"\u8170\u817F\u540C\u65F6\u53D1\u529B\u66F4\u7A33"**\uFF1A\u5F00\u73AF\u4E0B\u4E00\u8D77\u53D1\u529B\u6BD4\u5355\u72EC\u8170\u5012\u5F97\u66F4\u5FEB\uFF08\u4E24\u4FA7\u4F59\u91CF\u88AB\u540C\u65F6\u638F\u7A7A\uFF09',
  tWLA <= tW,
  `\u5355\u72EC\u8170 ${f(tW, 2)} s   \u8170+\u817F ${f(tWL, 2)} s   \u8170+\u817F+\u81C2 ${f(tWLA, 2)} s\uFF08\u8D8A\u5C0F = \u8D8A\u5148\u5012\uFF09`
);
check(
  'A9 \u2605\u2605 \u5BF9\u79F0 vs \u4E0D\u5BF9\u79F0\u7528\u81C2\uFF1A\u5B9E\u6D4B**\u5BF9\u79F0\u66F4\u5927**\uFF08\u63A8\u7FFB"\u5DE6\u53F3\u62B5\u6D88"\u7684\u76F4\u89C9\uFF09\uFF0C\u4F46\u4E24\u8005\u90FD\u4E0D\u6539\u53D8\u4E3B\u7ED3\u8BBA',
  Math.abs(armsSym.dXiZ) >= Math.abs(armsAsym.dXiZ),
  `\u5BF9\u79F0 ${f(armsSym.dXiZ, 4)} m   \u5355\u81C2 ${f(armsAsym.dXiZ, 4)} m`
);
log("");
log("  \u4FA7\u5411\u6743\u9650\u6392\u5E8F\uFF08|\u0394\u03BE_z|\uFF0C\u4EC5\u5B58\u6D3B\u914D\u7F6E\uFF09");
var okRows = rows.filter((r) => !r.fell).sort((a, b) => Math.abs(b.dXiZ) - Math.abs(a.dXiZ));
log("    " + (okRows.length ? okRows.map((r) => `${r.name}(${f(Math.abs(r.dXiZ), 4)})`).join("  ") : "\uFF08\u65E0\uFF09"));
log("");
log(`  ${failures === 0 ? "\u2605 \u5168\u7EFF" : `\u2718 ${failures} \u6761\u4E0D\u901A\u8FC7`}`);
log("");
process.exitCode = failures === 0 ? 0 : 1;
