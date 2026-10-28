import * as gpu from "pex-gpu";
import random from "pex-random";
import { cube, plane } from "primitive-geometry";
import computeEdges from "geom-edges";

random.seed("5");

const shader = /* wgsl */ `
struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
  color: vec4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) offset: vec4f,
) -> VertexOut {
  var output: VertexOut;
  let world = position * offset.w + offset.xyz;
  output.position = uniforms.projection * uniforms.view * vec4f(world, 1.0);
  output.color = mix(vec4f(normal * 0.5 + 0.5, 1.0), uniforms.color, uniforms.color.a);
  return output;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  return input.color;
}
`;

/**
 * Grid and cubes: a unit cube at the origin and a field of cubes around it, up
 * to `count` cubes in all.
 *
 * @returns {{ draw: Function; depthCompare: Function; cubeBox: number[][] }}
 */
export default function createScene(ctx, { count = 150, extent = 24 } = {}) {
  const geometry = cube();
  const grid = plane({ sx: 50, sy: 50, nx: 50, ny: 50, direction: "y" });

  // xyz offset, w scale. The first instance is the unit cube at the origin.
  const offsets = new Float32Array(Math.max(count, 1) * 4);
  offsets.set([0, 0, 0, 1]);
  for (let i = 1; i < count; i++) {
    const scale = 0.4 + random.float() * 1.6;
    offsets.set(
      [
        (random.float() * 2 - 1) * extent,
        scale / 2,
        (random.float() * 2 - 1) * extent,
        scale,
      ],
      i * 4,
    );
  }

  const vertex = (data) => gpu.createBuffer(ctx, { usage: "vertex", data });
  const instance = (data) => ({ buffer: vertex(data), stepMode: "instance" });

  const drawCubes = gpu.defineCommand({
    pipeline: { shader, depthWriteEnabled: true, cullMode: "back" },
    attributes: {
      position: vertex(geometry.positions),
      normal: vertex(geometry.normals),
      offset: instance(offsets),
    },
    indices: gpu.createBuffer(ctx, { usage: "index", data: geometry.cells }),
    instanceCount: count,
  });
  const drawGrid = gpu.defineCommand({
    pipeline: { shader, depthWriteEnabled: true, topology: "line-list" },
    attributes: {
      position: vertex(grid.positions),
      normal: vertex(grid.normals),
      offset: instance([0, 0, 0, 1]),
    },
    indices: gpu.createBuffer(ctx, {
      usage: "index",
      data: computeEdges(grid.cells),
    }),
  });

  // Commands created on demand, drawn with their own buffers.
  const extras = new Set();
  const drawExtra = (command, camera, viewport, color) =>
    gpu.submit(ctx, command, [
      {
        viewport,
        uniforms: {
          projection: camera.projectionMatrix,
          view: camera.viewMatrix,
          color,
        },
      },
    ]);

  // Polyline from flat positions, e.g. a rail.
  const lineCommand = (positions) => ({
    pipeline: { shader, depthWriteEnabled: true, topology: "line-strip" },
    attributes: {
      position: vertex(positions),
      normal: vertex(new Float32Array(positions.length).fill(1)),
      offset: instance([0, 0, 0, 1]),
    },
    count: positions.length / 3,
  });

  return {
    cubeBox: [
      [-0.5, -0.5, -0.5],
      [0.5, 0.5, 0.5],
    ],
    createLine(positions) {
      const command = lineCommand(positions);
      extras.add(command);
      return (camera, viewport, color = [1, 0.8, 0.2, 1]) =>
        drawExtra(command, camera, viewport, color);
    },
    /**
     * Cube following a position, e.g. a moving subject. Each marker owns its
     * offset buffer: queued buffer writes all land before the frame's draws,
     * so a shared one would draw every marker at the last position.
     */
    createMarker(scale = 0.5, color = [0.95, 0.2, 0.2, 1]) {
      const offset = gpu.createBuffer(ctx, {
        usage: "vertex",
        data: [0, 0, 0, scale],
      });
      const command = {
        ...drawCubes,
        attributes: {
          ...drawCubes.attributes,
          offset: { buffer: offset, stepMode: "instance" },
        },
        instanceCount: 1,
      };
      extras.add(command);
      return (camera, viewport, position) => {
        gpu.updateBuffer(ctx, offset, [...position, scale]);
        drawExtra(command, camera, viewport, color);
      };
    },
    depthCompare(reversedZ) {
      for (const command of [drawCubes, drawGrid, ...extras]) {
        command.pipeline.depthCompare = reversedZ
          ? "greater-equal"
          : "less-equal";
      }
    },
    draw(camera, viewport) {
      const uniforms = {
        projection: camera.projectionMatrix,
        view: camera.viewMatrix,
      };
      gpu.submit(ctx, drawGrid, [
        { viewport, uniforms: { ...uniforms, color: [1, 1, 1, 0.9] } },
      ]);
      if (count) {
        gpu.submit(ctx, drawCubes, [
          { viewport, uniforms: { ...uniforms, color: [0, 0, 0, 0] } },
        ]);
      }
    },
  };
}
