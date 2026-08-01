export class GLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GLError";
  }
}

export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  extensions: {
    colorBufferFloat: boolean;
    floatTexture: boolean;
  };
}

export function createGL(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    throw new GLError(
      "WebGL2 is not available. Fluxa requires a WebGL2-capable browser.",
    );
  }

  const colorBufferFloat = !!gl.getExtension("EXT_color_buffer_float");
  const floatTexture = !!gl.getExtension("OES_texture_float_linear");

  if (!colorBufferFloat) {
    throw new GLError(
      "EXT_color_buffer_float is required for Fluxa heightmap simulation.",
    );
  }

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);

  return {
    gl,
    canvas,
    extensions: { colorBufferFloat, floatTexture },
  };
}
