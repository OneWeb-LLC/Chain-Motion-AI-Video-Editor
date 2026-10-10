# Set Studio runtime dependencies

Vendored browser modules; no CDN or network dependency at runtime:

- Three.js 0.180.0: `three.core.js`, `three.module.js`, OrbitControls and TransformControls. https://github.com/mrdoob/three — MIT; license in `three/LICENSE`.
- Spark 0.1.10: `spark.module.js`, including its embedded splat decoding/sorting workers and WASM. https://github.com/sparkjsdev/spark — MIT; license in `spark/LICENSE`.

Obtained from the pinned npm packages `three@0.180.0` and `@sparkjsdev/spark@0.1.10`. Import mappings are in `static/set-studio.html`. Keep matching license files when updating these modules.

Set Studio also vendors GLTFLoader, SkeletonUtils and BufferGeometryUtils from the same Three.js 0.180.0 package to load and independently clone the bundled mannequin skeleton.
