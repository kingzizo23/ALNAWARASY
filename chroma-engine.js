/**
 * ChromaEngine - محرك عزل الكروما في الوقت الفعلي باستخدام WebGL2
 * يعتمد على خوارزمية الفضاء اللوني YCbCr لحساب المسافة اللونية بدقة وتنعيم الحواف وإزالة الانعكاس
 */
export class ChromaEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    if (!this.gl) {
      throw new Error('متصفحك لا يدعم WebGL2. يرجى استخدام متصفح حديث مثل Chrome أو Firefox أو Safari.');
    }

    this.initShaders();
  }

  initShaders() {
    const gl = this.gl;

    const vsSource = `#version 300 es
      in vec2 a_pos;
      in vec2 a_tex;
      out vec2 v_tex;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_tex = a_tex;
      }`;

    const fsSource = `#version 300 es
      precision mediump float;
      uniform sampler2D u_tex;
      uniform vec3 u_keyColor;
      uniform float u_similarity;
      uniform float u_smoothness;
      uniform float u_spill;
      in vec2 v_tex;
      out vec4 outColor;

      // تحويل RGB إلى المركبتين اللونيّتين Cb و Cr
      vec2 rgb2uv(vec3 rgb) {
        return vec2(
          rgb.r * -0.168736 + rgb.g * -0.331264 + rgb.b *  0.500000 + 0.5,
          rgb.r *  0.500000 + rgb.g * -0.418688 + rgb.b * -0.081312 + 0.5
        );
      }

      void main() {
        vec4 rgba = texture(u_tex, v_tex);

        // حساب المسافة بين لون البكسل ولون الكروما في فضاء UV
        float chromaDist = distance(rgb2uv(rgba.rgb), rgb2uv(u_keyColor));
        float baseMask = chromaDist - u_similarity;
        float alpha = clamp(baseMask / max(u_smoothness, 0.001), 0.0, 1.0);

        // إزالة الهالة الخضراء/الزرقاء المنعكسة على الحواف (Spill Suppression)
        float spillVal = pow(clamp(baseMask / max(u_spill, 0.001), 0.0, 1.0), 1.5);
        float luma = dot(rgba.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 finalRgb = mix(vec3(luma), rgba.rgb, spillVal);

        outColor = vec4(finalRgb, rgba.a * alpha);
      }`;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(this.program);
      throw new Error('فشل تجميع برنامج الـ Shader: ' + err);
    }

    gl.useProgram(this.program);

    // تجهيز مصفوفة الإحداثيات (Quad) مع قلب محور Y للتعامل السليم مع الفيديو
    const quad = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.program, 'a_pos');
    const texLoc = gl.getAttribLocation(this.program, 'a_tex');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    // إنشاء نسيج الفيديو (Texture)
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // تخزين مواقع المتغيرات الموحدة (Uniform Locations) لتسريع الأداء
    this.uKeyColor = gl.getUniformLocation(this.program, 'u_keyColor');
    this.uSimilarity = gl.getUniformLocation(this.program, 'u_similarity');
    this.uSmoothness = gl.getUniformLocation(this.program, 'u_smoothness');
    this.uSpill = gl.getUniformLocation(this.program, 'u_spill');
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');
    gl.uniform1i(this.uTex, 0);
  }

  compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('فشل ترجمة الـ Shader: ' + err);
    }
    return shader;
  }

  render(video, params) {
    const gl = this.gl;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.uniform3fv(this.uKeyColor, params.keyColor);
    gl.uniform1f(this.uSimilarity, params.similarity);
    gl.uniform1f(this.uSmoothness, params.smoothness);
    gl.uniform1f(this.uSpill, params.spill);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
