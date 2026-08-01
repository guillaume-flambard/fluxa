import { GLError } from "./context.js";

export interface PingPongTarget {
  read: FrameTarget;
  write: FrameTarget;
  width: number;
  height: number;
  swap: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

export interface FrameTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): FrameTarget {
  const texture = gl.createTexture();
  if (!texture) throw new GLError("Failed to create texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG32F,
    width,
    height,
    0,
    gl.RG,
    gl.FLOAT,
    null,
  );

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new GLError("Failed to create framebuffer");

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture, framebuffer };
}

function destroyTarget(gl: WebGL2RenderingContext, target: FrameTarget): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

export function createPingPong(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): PingPongTarget {
  let w = Math.max(1, width | 0);
  let h = Math.max(1, height | 0);
  let a = createTarget(gl, w, h);
  let b = createTarget(gl, w, h);

  // Clear both to zero height
  for (const t of [a, b]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    get read() {
      return a;
    },
    get write() {
      return b;
    },
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    swap() {
      const tmp = a;
      a = b;
      b = tmp;
    },
    resize(width: number, height: number) {
      const nw = Math.max(1, width | 0);
      const nh = Math.max(1, height | 0);
      if (nw === w && nh === h) return;
      destroyTarget(gl, a);
      destroyTarget(gl, b);
      w = nw;
      h = nh;
      a = createTarget(gl, w, h);
      b = createTarget(gl, w, h);
      for (const t of [a, b]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      destroyTarget(gl, a);
      destroyTarget(gl, b);
    },
  };
}
