import type { Rgb } from "./engine.ts";
import { particleTexture, type ParticleTextureName } from "./textures.ts";

/**
 * The particle panel's renderer. Like CS2's particle panel it blends in linear light at high precision: every
 * sprite adds its coloured light into a half-float framebuffer, black occluders cover it, and a final pass
 * tone-maps the intensity, encodes it for display and washes it with the team colour. An 8-bit canvas clipped
 * overlaps and banded the faint tails, and colouring before the tone map turned a light team colour white.
 */

/** "add": light added (PARTICLE_OUTPUT_BLEND_MODE_ADD); "alpha": laid over what is below (the default blend; black for the masks). */
export type BlendMode = "add" | "alpha";

/**
 * A quad's colour: overbright x particle colour, its alpha, whether the colour saturates before the alpha
 * (m_bSaturateColorPreAlphaBlend) and how far colour x texture is pulled towards its luminance (m_flDesaturation).
 */
export type QuadPaint = { color: Rgb; alpha: number; saturate: boolean; desaturation?: number };

/** Floats per vertex: x, y (panel px), u, v, colour (linear RGB), alpha, saturate flag, desaturation. */
const STRIDE = 10;
const MAX_QUADS = 2048;

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUv;
in vec3 aColor;
in float aAlpha;
in float aSaturate;
in float aDesaturation;
uniform vec2 uSize;
out vec2 vUv;
out vec3 vColor;
out float vAlpha;
out float vSaturate;
out float vDesaturation;
void main() {
  vUv = aUv;
  vColor = aColor;
  vAlpha = aAlpha;
  vSaturate = aSaturate;
  vDesaturation = aDesaturation;
  gl_Position = vec4(aPosition.x / uSize.x * 2.0 - 1.0, 1.0 - aPosition.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
in float vSaturate;
in float vDesaturation;
uniform sampler2D uTexture;
out vec4 color;
// The spritecard shader: colour x texture colour, desaturated towards its luminance, saturated unless the renderer
// turns that off, times alpha; the texture alpha goes through the default alpha remap (smoothstep from 0 to 1),
// which darkens soft tails.
void main() {
  vec4 texel = texture(uTexture, vUv);
  vec3 light = vColor * texel.rgb;
  light = mix(light, vec3(dot(light, vec3(0.2125, 0.7154, 0.0721))), vDesaturation);
  if (vSaturate > 0.5) light = clamp(light, 0.0, 1.0);
  float alpha = smoothstep(0.0, 1.0, texel.a) * vAlpha;
  color = vec4(light * alpha, alpha);
}`;

const PRESENT_VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

/**
 * Exposure and the tone map, then the team colour wash. CS2 lays the panel over the scene with the
 * display value as alpha (a saturated pixel is the wash colour whatever is behind it), so the output is the wash
 * premultiplied by that value.
 */
const PRESENT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPanel;
uniform vec3 uWash;
uniform float uExposure;
out vec4 color;
void main() {
  vec3 light = max(texture(uPanel, vUv).rgb, 0.0);
  // Per channel, written as is, without sRGB encoding: the recording's faint light is linear in the panel's light.
  vec3 display = 1.0 - exp(-light * uExposure);
  color = vec4(uWash * display, max(display.r, max(display.g, display.b)));
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[bottomhud] particle shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

export class PanelRenderer {
  private readonly vertices = new Float32Array(MAX_QUADS * 6 * STRIDE);
  private count = 0;
  private texture: ParticleTextureName | null = null;
  private blend: BlendMode = "add";
  private readonly textures = new Map<ParticleTextureName, WebGLTexture>();

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly width: number,
    private readonly height: number,
    private readonly draw: { program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; size: WebGLUniformLocation | null },
    private readonly present: { program: WebGLProgram; vao: WebGLVertexArrayObject; wash: WebGLUniformLocation | null; exposure: WebGLUniformLocation | null },
    private readonly target: { framebuffer: WebGLFramebuffer; texture: WebGLTexture },
  ) {}

  /** A renderer for a panel `width` x `height` px drawn at `ratio` device pixels per px; null without WebGL2 float targets. */
  static create(canvas: HTMLCanvasElement, width: number, height: number, ratio: number): PanelRenderer | null {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
    const program = compile(gl, VERTEX, FRAGMENT);
    const presentProgram = compile(gl, PRESENT_VERTEX, PRESENT_FRAGMENT);
    if (!program || !presentProgram) return null;

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_QUADS * 6 * STRIDE * 4, gl.DYNAMIC_DRAW);
    const attribute = (name: string, size: number, offset: number) => {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    attribute("aPosition", 2, 0);
    attribute("aUv", 2, 2);
    attribute("aColor", 3, 4);
    attribute("aAlpha", 1, 7);
    attribute("aSaturate", 1, 8);
    attribute("aDesaturation", 1, 9);

    const presentVao = gl.createVertexArray();
    gl.bindVertexArray(presentVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(presentProgram, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, canvas.width, canvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return new PanelRenderer(
      gl, width, height,
      { program, vao, buffer, size: gl.getUniformLocation(program, "uSize") },
      { program: presentProgram, vao: presentVao, wash: gl.getUniformLocation(presentProgram, "uWash"), exposure: gl.getUniformLocation(presentProgram, "uExposure") },
      { framebuffer, texture },
    );
  }

  /** Starts a frame: an empty (black) panel. */
  begin(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.draw.program);
    gl.uniform2f(this.draw.size, this.width, this.height);
    gl.bindVertexArray(this.draw.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.draw.buffer);
    gl.enable(gl.BLEND);
    this.texture = null;
  }

  /**
   * A textured quad: corners in panel px (top-left, top-right, bottom-right, bottom-left, mapped to uv 0,0 / 1,0 /
   * 1,1 / 0,1).
   */
  quad(texture: ParticleTextureName, corners: readonly (readonly [number, number])[], paint: QuadPaint, blend: BlendMode = "add"): void {
    if (texture !== this.texture || blend !== this.blend || this.count >= MAX_QUADS) this.flush();
    this.texture = texture;
    this.blend = blend;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
    let offset = this.count * 6 * STRIDE;
    for (const index of [0, 1, 2, 0, 2, 3]) {
      this.vertices[offset] = corners[index][0];
      this.vertices[offset + 1] = corners[index][1];
      this.vertices[offset + 2] = uv[index][0];
      this.vertices[offset + 3] = uv[index][1];
      this.vertices[offset + 4] = paint.color[0];
      this.vertices[offset + 5] = paint.color[1];
      this.vertices[offset + 6] = paint.color[2];
      this.vertices[offset + 7] = paint.alpha;
      this.vertices[offset + 8] = paint.saturate ? 1 : 0;
      this.vertices[offset + 9] = paint.desaturation ?? 0;
      offset += STRIDE;
    }
    this.count += 1;
  }

  /** A square sprite of half-size `radius` px centred at (x, y), rotated `rotation` radians (counter-clockwise on screen). */
  sprite(texture: ParticleTextureName, x: number, y: number, radius: number, rotation: number, paint: QuadPaint, blend: BlendMode = "add"): void {
    const cos = Math.cos(rotation) * radius;
    const sin = Math.sin(rotation) * radius;
    // Screen y grows downwards, so a counter-clockwise turn is (cos, -sin) for the u axis.
    const corner = (u: number, v: number) => [x + u * cos + v * sin, y - u * sin + v * cos] as const;
    this.quad(texture, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], paint, blend);
  }

  private flush(): void {
    if (this.count === 0 || this.texture === null) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textureFor(this.texture));
    if (this.blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices, 0, this.count * 6 * STRIDE);
    gl.drawArrays(gl.TRIANGLES, 0, this.count * 6);
    this.count = 0;
  }

  private textureFor(name: ParticleTextureName): WebGLTexture {
    let texture = this.textures.get(name);
    if (!texture) {
      const gl = this.gl;
      const { width, height, data } = particleTexture(name);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(name, texture);
    }
    return texture;
  }

  /** Ends a frame: tone-maps the panel onto the canvas, washed with `wash` (display RGB 0..1). */
  end(wash: readonly [number, number, number], exposure: number): void {
    this.flush();
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.present.program);
    gl.bindVertexArray(this.present.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
    gl.uniform3f(this.present.wash, wash[0], wash[1], wash[2]);
    gl.uniform1f(this.present.exposure, exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Clears the visible canvas. */
  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Frees the GL context (browsers cap the number of live contexts). */
  dispose(): void {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
