# Video Enhancement, Perceptual Hashing & Uniqueness Engineering Specification
**Target Applications**: Short-Form Video Optimization (TikTok, Reels, Shorts), Anti-Fingerprinting, Natural Camera Emulation, AI Footage De-Synthetic Conditioning.
**Author**: Subagent 4 - Video Processing & Visual Enhancement Engineer

---

## 1. Perceptual Hashing & Visual Comparison Metrics: Mathematical Foundations

Short-form video platforms (TikTok, Meta Reels, YouTube Shorts) deploy automated ingestion filters to detect republished, cloned, or copyrighted content. These systems extract visual and acoustic fingerprints to query high-dimensional vector databases at billion-item scale. To engineer video enhancement pipelines that evade automated deduplication while maintaining high visual quality, one must understand the exact mathematical foundations of perceptual hashing algorithms and quality metrics.

```
+---------------------------------------------------------------------------------------------------+
|                               Video Deduplication Detection Pipeline                              |
+---------------------------------------------------------------------------------------------------+
|  Input Video Frame(s)                                                                             |
|         │                                                                                         |
|         ├───► Preprocessing: Grayscale Conversion + Dimension Rescaling (e.g., 32x32, 9x8)        |
|         │                                                                                         |
|         ├───► Spatial Transform: 2D-DCT-II (pHash, PDQ) or Finite Spatial Difference (dHash, BMV) |
|         │                                                                                         |
|         ├───► Feature Extraction: Low-Frequency Energy Selection / Median Quantization            |
|         │                                                                                         |
|         ├───► Binary Fingerprint Generation (64-bit to 256-bit Hash Vectors)                      |
|         │                                                                                         |
|         ├───► Multi-Probe Locality-Sensitive Hashing (LSH) / Hamming Ball Search                   |
|         │                                                                                         |
|         └───► Structural Verification: Local SSIM / MS-SSIM Window Analysis                       |
+---------------------------------------------------------------------------------------------------+
```

---

### 1.1 pHash (Perceptual Hash / DCT-Based Hash)

Perceptual Hash (pHash) computes a compact binary representation of an image based on its low-frequency spectral content. Natural images have high spectral energy concentrated in low frequencies, making the low-frequency DCT coefficients robust to high-frequency perturbations (such as re-encoding, minor compression, or light noise) while capturing coarse structural geometry.

#### Mathematical Steps:
1. **Luma Extraction**: The color frame $I(x, y)$ is converted to grayscale luminance $Y(x, y)$ using ITU-R BT.601 / BT.709 colorimetry:
   $$Y(x, y) = 0.299 \cdot R(x, y) + 0.587 \cdot G(x, y) + 0.114 \cdot B(x, y)$$

2. **Downsampling**: The frame is rescaled to a fixed square resolution $N \times N$ (typically $32 \times 32$ pixels, $N=32$) using bicubic or bilinear interpolation to eliminate high-frequency spatial details.

3. **Two-Dimensional Discrete Cosine Transform (2D DCT-II)**:
   For an $N \times N$ matrix of luminance values $f(x, y)$, the 2D DCT-II is defined as:
   $$F(u, v) = \alpha(u) \alpha(v) \sum_{x=0}^{N-1} \sum_{y=0}^{N-1} f(x, y) \cos \left[ \frac{\pi}{N} \left(x + \frac{1}{2}\right) u \right] \cos \left[ \frac{\pi}{N} \left(y + \frac{1}{2}\right) v \right]$$
   where the orthogonal normalization factors are:
   $$\alpha(u) = \begin{cases} \sqrt{\frac{1}{N}} & \text{if } u = 0 \\ \sqrt{\frac{2}{N}} & \text{if } u > 0 \end{cases}$$

4. **Coefficient Truncation**:
   Human vision is insensitive to high-frequency DCT coefficients, and common image manipulations discard them. pHash isolates the top-left submatrix of size $M \times M$ (typically $8 \times 8$, $M=8$, yielding 64 coefficients), representing the lowest spatial frequencies.

5. **Median Quantization**:
   The DC coefficient $F(0, 0)$ represents the average illumination of the entire frame:
   $$F(0, 0) = \frac{1}{N} \sum_{x=0}^{N-1} \sum_{y=0}^{N-1} f(x, y)$$
   To achieve invariance against global exposure and brightness shifts, $F(0, 0)$ is either discarded or ignored. The median $\mu$ of the remaining $M^2 - 1$ AC coefficients is calculated:
   $$\mu = \text{median}\Big( \big\{ F(u, v) \mid 0 \le u, v < M, \; (u, v) \neq (0, 0) \big\} \Big)$$

6. **Hash Bit Assignment**:
   Each bit $b_i$ of the 64-bit hash vector $\mathbf{h} \in \{0, 1\}^{64}$ is assigned according to:
   $$b_{u \cdot M + v} = \begin{cases} 1 & \text{if } F(u, v) > \mu \\ 0 & \text{otherwise} \end{cases}$$

7. **Distance Metric (Hamming Distance)**:
   The perceptual similarity between two frames with hashes $\mathbf{h}_1$ and $\mathbf{h}_2$ is measured by their Hamming distance $D_H$:
   $$D_H(\mathbf{h}_1, \mathbf{h}_2) = \sum_{k=0}^{63} \big( \mathbf{h}_1[k] \oplus \mathbf{h}_2[k] \big)$$
   - $D_H \le 5$: Highly likely duplicate / near-identical frame.
   - $5 < D_H \le 12$: Structurally related, visually modified.
   - $D_H > 15$: Perceptually distinct image content.

---

### 1.2 dHash (Difference Hash / Gradient Hash)

Difference Hash (dHash) computes local spatial gradients between horizontally (or vertically) adjacent pixels. It is computationally light ($O(N)$ vs $O(N^2 \log N)$ for DCT) and invariant to monotonic brightness shifts.

#### Mathematical Formulation:
1. **Grayscale Downsampling**: Downsample the image to $(K+1) \times K$ pixels. For a 64-bit hash, downsample to $9 \times 8$ (9 columns, 8 rows).
2. **First-Order Finite Difference**: Compute the horizontal intensity differential between column $x+1$ and column $x$:
   $$\Delta_x I(x, y) = I(x+1, y) - I(x, y), \quad x \in [0, K-1], \; y \in [0, K-1]$$
3. **Binary Quantization**:
   $$h(y, x) = \begin{cases} 1 & \text{if } \Delta_x I(x, y) > 0 \iff I(x+1, y) > I(x, y) \\ 0 & \text{otherwise} \end{cases}$$
4. **Properties**:
   - Fully invariant to any strictly monotonic global tone mapping $I' = g(I)$ where $g'(I) > 0$.
   - Highly vulnerable to horizontal mirror flips ($\Delta_x$ flips sign completely, yielding inverted or uncorrelated bits) and micro-rotations.

---

### 1.3 PDQ Hash (Facebook / Meta Open-Source Perceptual Hash)

PDQ is an industrial-grade perceptual hashing algorithm designed by Meta specifically to withstand typical digital modifications: compression, watermarks, re-scaling, cropping, and aspect-ratio modifications.

#### Core Algorithmic Mechanics:
1. **Luma Downsampling with Decimation Filter**:
   The input image is converted to grayscale and rescaled to a $64 \times 64$ grid using a non-uniform anti-aliasing decimation kernel (or Jarvis/Bilinear filter).
2. **$64 \times 64$ 2D DCT**:
   A full $64 \times 64$ Discrete Cosine Transform is applied to the downsampled grid.
3. **$16 \times 16$ Low-Frequency Feature Extraction**:
   PDQ extracts a $16 \times 16$ block of low-to-mid frequency coefficients, producing a **256-bit binary hash**.
4. **Dihedral Invariance (D4 Symmetry Group)**:
   PDQ hashes are tested across 8 spatial transformations (rotations of $0^\circ, 90^\circ, 180^\circ, 270^\circ$, plus horizontal reflections) to identify flipped or rotated media.
5. **Quality Metric**:
   PDQ computes an internal image quality/texture score:
   $$Q = \sum_{u=0}^{15}\sum_{v=0}^{15} |F(u, v)|$$
   If an image has near-zero texture (e.g. solid color or blank screen), $Q$ drops below threshold, flagging the hash as unmatchable/low-entropy to prevent false positives.
6. **Matching Criteria**:
   - $D_H < 32$ out of 256 bits ($\approx 87.5\%$ similarity): High-confidence duplicate.

---

### 1.4 SSIM (Structural Similarity Index Measure) & MS-SSIM

Unlike point-to-point error metrics (MSE, PSNR) that measure pixel-level numerical deviation without regard to spatial correlation, SSIM assesses degradation of structural information under the assumption that the Human Visual System (HVS) is adapted to extract structural details from visual scenes.

#### Decomposition Formula:
SSIM decomposes comparison into three orthogonal components:
$$\text{SSIM}(\mathbf{x}, \mathbf{y}) = \big[ l(\mathbf{x}, \mathbf{y}) \big]^\alpha \cdot \big[ c(\mathbf{x}, \mathbf{y}) \big]^\beta \cdot \big[ s(\mathbf{x}, \mathbf{y}) \big]^\gamma$$
where $\alpha = \beta = \gamma = 1$.

1. **Luminance Comparison**:
   $$l(\mathbf{x}, \mathbf{y}) = \frac{2 \mu_x \mu_y + C_1}{\mu_x^2 + \mu_y^2 + C_1}$$
2. **Contrast Comparison**:
   $$c(\mathbf{x}, \mathbf{y}) = \frac{2 \sigma_x \sigma_y + C_2}{\sigma_x^2 + \sigma_y^2 + C_2}$$
3. **Structure Comparison**:
   $$s(\mathbf{x}, \mathbf{y}) = \frac{\sigma_{xy} + C_3}{\sigma_x \sigma_y + C_3}$$

Setting $C_3 = C_2 / 2$ yields the standard form:
$$\text{SSIM}(\mathbf{x}, \mathbf{y}) = \frac{(2 \mu_x \mu_y + C_1)(2 \sigma_{xy} + C_2)}{(\mu_x^2 + \mu_y^2 + C_1)(\sigma_x^2 + \sigma_y^2 + C_2)}$$

#### Windowing & Statistical Parameters:
- Local statistics are computed inside an $11 \times 11$ sliding Gaussian window $\mathbf{w} = \{w_i \mid i=1, \dots, W\}$ with standard deviation $\sigma = 1.5$:
  $$\mu_x = \sum_{i=1}^W w_i x_i, \quad \sigma_x^2 = \sum_{i=1}^W w_i (x_i - \mu_x)^2, \quad \sigma_{xy} = \sum_{i=1}^W w_i (x_i - \mu_x)(y_i - \mu_y)$$
- Regularization constants prevent division by zero in smooth/dark regions:
  $$C_1 = (K_1 L)^2, \quad C_2 = (K_2 L)^2, \quad K_1 = 0.01, \; K_2 = 0.03, \; L = 255$$
  $$C_1 = (0.01 \cdot 255)^2 = 6.5025, \quad C_2 = (0.03 \cdot 255)^2 = 58.5225$$

#### Multi-Scale SSIM (MS-SSIM):
MS-SSIM addresses the scale-dependence of HVS sensitivity by evaluating luminance only at the coarsest scale $M$, while evaluating contrast and structure across $M$ dyadically downsampled scales:
$$\text{MS-SSIM}(\mathbf{x}, \mathbf{y}) = \big[ l_M(\mathbf{x}, \mathbf{y}) \big]^{\alpha_M} \prod_{j=1}^M \big[ c_j(\mathbf{x}, \mathbf{y}) \big]^{\beta_j} \big[ s_j(\mathbf{x}, \mathbf{y}) \big]^{\gamma_j}$$

---

### 1.5 Block Mean Value (BMV) Hash

BMV partitions the frame into an $M \times N$ matrix of spatial blocks $B_{i, j}$:
$$\bar{I}_{i, j} = \frac{1}{|B_{i, j}|} \sum_{(x, y) \in B_{i, j}} I(x, y)$$
The hash bits are derived by thresholding against either:
1. **Global Frame Mean**:
   $$\bar{I}_{\text{global}} = \frac{1}{M \cdot N} \sum_{i=1}^M \sum_{j=1}^N \bar{I}_{i, j}, \quad H(i, j) = \begin{cases} 1 & \text{if } \bar{I}_{i, j} \ge \bar{I}_{\text{global}} \\ 0 & \text{otherwise} \end{cases}$$
2. **Differential Neighboring Blocks**:
   $$H(i, j) = \begin{cases} 1 & \text{if } \bar{I}_{i, j} > \bar{I}_{i, j+1} \\ 0 & \text{otherwise} \end{cases}$$

---

### 1.6 Temporal Aggregation & Ingestion Matching in Video Platforms

In video deduplication pipelines (e.g. YouTube Content ID, TikTok Video Matching):
1. **Keyframe Sampling**: Hashes are extracted at fixed intervals $\Delta t \approx 0.5 - 1.0\text{s}$ or at scene change boundaries (detected via HSV histogram chi-squared distance or SSIM drops below $0.6$).
2. **Trajectory Sequence Matching**:
   A video $V$ produces a temporal hash sequence $S_V = [\mathbf{h}_1, \mathbf{h}_2, \dots, \mathbf{h}_K]$.
   Similarity between two videos $A$ and $B$ is computed via:
   - **Dynamic Time Warping (DTW)** on the sequence of Hamming distances.
   - **Min-Hash & Multi-Probe LSH**: Fast candidate retrieval in $O(1)$ lookup time, followed by precise pairwise sequence alignment.
3. **Thresholding for Re-Upload Detection**:
   If $\ge 80\%$ of sampled frames maintain $D_H \le 8$ and audio fingerprint (Chromaprint/AcoustID) matches, the video is flagged as duplicate.

---

## 2. Natural Camera Simulation vs Synthetic Texture Enhancement

AI video generators (Sora, Kling, Runway Gen-3, CogVideoX, LTX-Video) exhibit specific synthetic artifacts that platform classification models and perceptual hashes flag.

```
+---------------------------------------------------------------------------------------------------+
|                        Physical Sensor vs AI Video Artifact Comparison                            |
+---------------------------------------------------------------------------------------------------+
|  Dimension                  | Physical Camera (CMOS/CCD)         | AI Synthetic Video             |
+-----------------------------+------------------------------------+--------------------------------+
|  High-Frequency Texture     | Poisson shot noise + CMOS PRNU     | Oversmoothed, "plastic" skin   |
|  Power Spectral Density     | Natural $1/f^\gamma$ roll-off      | Premature roll-off / spikes    |
|  Temporal Noise Continuity  | Frame-independent shot noise       | Latent flickering or smearing  |
|  Sensor Signature           | Fixed PRNU fingerprint matrix      | None (zero hardware trace)     |
|  Lens Imperfections         | Radial CA + vignetting ($cos^4$)   | Perfect/flat optical field     |
+---------------------------------------------------------------------------------------------------+
```

### 2.1 The Physics of Physical Sensor Noise
A real digital camera sensor records an observed pixel intensity $Y(x, y)$ that consists of incident scene radiance degraded by optical and electrical physical processes:
$$Y(x, y) = g \cdot \big[ N_e(x, y) + N_{\text{read}} \big] + N_{\text{ADC}}$$

1. **Photon Shot Noise (Poisson Process)**:
   Photons hitting the silicon photodiode follow Poisson distribution statistics. For an expected photon count $\lambda$:
   $$P(k) = \frac{\lambda^k e^{-\lambda}}{k!}, \quad \text{Var}(N_{\text{shot}}) = \mathbb{E}[N_{\text{shot}}] = \lambda$$
   Shot noise variance is strictly proportional to local luminance: **brighter regions have higher absolute noise variance, but higher Signal-to-Noise Ratio (SNR $\propto \sqrt{\lambda}$)**. Dark/shadow regions have low SNR, causing noticeable noise grain.

2. **Readout Noise (Gaussian Process)**:
   Thermal noise (Johnson-Nyquist noise in the readout amplifier) and reset noise (kTC noise in capacitor reset):
   $$N_{\text{read}} \sim \mathcal{N}(0, \sigma_{\text{read}}^2)$$

3. **Heteroscedastic Gaussian Noise Model**:
   Combining shot noise and read noise approximates:
   $$Y(x) \sim \mathcal{N}\big(X(x), \; a \cdot X(x) + b\big)$$
   where $X(x)$ is true irradiance, $a$ scales with sensor analog gain (ISO), and $b$ represents sensor read noise variance.

4. **PRNU (Photo-Response Non-Uniformity)**:
   Every physical sensor contains microscopic silicon fabrication variations, resulting in deterministic pixel-to-pixel gain variations:
   $$I(x, y) = I_0(x, y) \cdot [1 + K(x, y)] + \Theta(x, y)$$
   where $K(x, y)$ is a zero-mean 2D matrix ($\sigma_K \approx 0.005 - 0.015$) unique to that specific silicon wafer. Forensic platforms calculate the Normalized Cross-Correlation (NCC) between the extracted high-frequency residual $W = I - F_{\text{denoise}}(I)$ and reference sensor patterns to verify physical camera authenticity.

### 2.2 Restoring Natural Frequency Distribution to AI Footage
AI models minimize MSE / perceptual loss across latent feature spaces, resulting in:
- High spatial frequency suppression (lack of micro-texture).
- Power Spectral Density (PSD) deviations from natural scene statistics ($P(f) \propto 1 / f^\gamma$, where $\gamma \approx 1.8 - 2.2$).

#### Restoration Strategy:
1. **Luminance-Dependent Dynamic Grain Synthesis**:
   Inject synthetic noise modeled as heteroscedastic noise: $\sigma^2(Y) = a \cdot (1 - Y) + b$ (inverted to match human perceptual visibility: noise is most apparent in mid-tones and shadows, and attenuated in specular highlights).
2. **Band-Limited Spatial Filtering of Noise**:
   Avoid pure single-pixel white noise (which video encoders like x264/HEVC immediately discard as high-entropy garbage during motion estimation). Instead, apply a spatial shaping filter (Gaussian blur $\sigma \approx 0.5 - 0.8$ or 2D FIR bandpass filter) to simulate realistic 35mm grain cluster diameter ($\approx 10-20\,\mu\text{m}$).
3. **Temporal Autoregressive Noise Modeling**:
   Generate noise with weak temporal correlation:
   $$\eta_t(x, y) = \rho \cdot \eta_{t-1}(x, y) + \sqrt{1 - \rho^2} \cdot \xi_t(x, y), \quad \rho \in [0.15, 0.30]$$
   This prevents the "dancing swarm of insects" look of uncorrelated white noise and survives video compression.
4. **Lens Dispersion & Radial Optical Falloff**:
   Apply subtle lateral chromatic aberration (radial wavelength displacement) and $\cos^4(\theta)$ vignetting to break synthetic spatial uniformity.

---

## 3. Production-Ready FFmpeg Filter Chains & Parameters

The following modular FFmpeg filter chains provide battle-tested, high-performance video manipulation to modify perceptual hashes, inject natural camera artifacts, and optimize short-form video encoding.

### 3.1 Dynamic Spatial-Temporal Film Grain / Sensor Noise Filtergraph

```bash
# High-Fidelity Luminance-Modulated Dynamic Spatio-Temporal Sensor Grain
ffmpeg -y -i input.mp4 -filter_complex \
"[0:v]split=2[base][grain_ref]; \
 [grain_ref]format=gray,noise=alls=12:allf=t+u,avgblur=sizeX=2:sizeY=2[grain]; \
 [base][grain]blend=all_mode=overlay:all_opacity=0.35,format=yuv420p[outv]" \
-map "[outv]" -map 0:a? -c:v libx264 -crf 19 -preset slow -c:a copy output_grained.mp4
```

#### Parameter Breakdown:
- `noise=alls=12:allf=t+u`:
  - `alls=12`: Spatial noise intensity set to 12 (on a 0-100 scale). Values between 8 and 14 create subtle grain without visible artifacting.
  - `allf=t+u`: Dynamic flags. `t` = temporal noise (varies across frames); `u` = uniform distribution (produces a softer visual distribution than extreme Gaussian peaks).
- `avgblur=sizeX=2:sizeY=2`: Spatially correlates adjacent noise pixels, converting single-pixel white noise into 35mm film grain clusters that survive H.264/H.265 DCT quantization.
- `blend=all_mode=overlay:all_opacity=0.35`: Blends the synthetic grain layer over the footage using an Overlay transfer function. Highlights and deep blacks retain high contrast, while mid-tones receive the highest grain density.

---

### 3.2 Subtle Geometric & Framing Adjustments (Micro-Scale, Crop, Perspective)

```bash
# Micro-Zoom (1.018x), Centered Crop, and Barrel Distortion Calibration
ffmpeg -y -i input.mp4 -vf \
"scale=w='trunc(iw*1.018/2)*2':h='trunc(ih*1.018/2)*2':flags=lanczos, \
 crop=w='trunc(in_w/1.018/2)*2':h='trunc(in_h/1.018/2)*2', \
 lenscorrection=cx=0.5:cy=0.5:k1=-0.0035:k2=0.001" \
-c:v libx264 -crf 18 -preset medium -c:a copy output_geometric.mp4
```

#### Parameter Breakdown:
- `scale=iw*1.018:ih*1.018:flags=lanczos`: Enlarges frame dimensions by $1.8\%$. This shifts spatial coordinates and redistributes the $32 \times 32$ downsampled grid points during pHash DCT extraction, changing frequency coefficients. Lanczos filtering prevents aliasing artifacts.
- `crop=...:(in_w-out_w)/2:(in_h-out_h)/2`: Crops the enlarged frame back to the native canvas resolution ($1080 \times 1920$), eliminating border padding.
- `lenscorrection=cx=0.5:cy=0.5:k1=-0.0035:k2=0.001`:
  - Simulates the radial distortion of real wide-angle phone lenses ($f \approx 24-26\text{mm}$).
  - $k_1 = -0.0035$ produces subtle barrel distortion at the corners while keeping center faces undistorted.
  - Non-linearly alters spatial coordinates across the entire image plane, causing significant divergence in dHash and pHash metrics.

---

### 3.3 Color Grading, Contrast Tuning, and Sub-Perceptual LUT Curves

```bash
# Non-Linear S-Curve Tone Mapping, Micro-Saturation, and Subtle Warm Cast
ffmpeg -y -i input.mp4 -vf \
"curves=master='0/0 0.25/0.235 0.5/0.505 0.75/0.765 1/1':red='0/0 0.5/0.508 1/1':blue='0/0 0.5/0.492 1/1', \
 eq=contrast=1.025:saturation=1.035:gamma=0.992" \
-c:v libx264 -crf 18 -preset slow -c:a copy output_graded.mp4
```

#### Parameter Breakdown:
- `curves=master='0/0 0.25/0.235 0.5/0.505 0.75/0.765 1/1'`: Implements a subtle S-curve that deepens shadows ($0.25 \to 0.235$) and lifts highlights ($0.75 \to 0.765$), increasing visual contrast.
- `red=...:blue=...`: Applies a microscopic warm bias ($+0.8\%$ Red in mid-tones, $-0.8\%$ Blue), simulating a $5600\text{K} \to 5400\text{K}$ color temperature shift that alters RGB matrix relationships.
- `eq=contrast=1.025:saturation=1.035:gamma=0.992`: Modulates global luma/chroma dynamics without clipping highlights.

---

### 3.4 Pacing, Micro-Speed Retiming, and Timestamp Normalization

```bash
# 1.014x Micro-Speed Retiming (Pitch-Preserved Audio, CFR 30fps Normalization)
ffmpeg -y -i input.mp4 -filter_complex \
"[0:v]setpts=PTS/1.014,fps=fps=30:round=near[outv]; \
 [0:a]atempo=1.014[outa]" \
-map "[outv]" -map "[outa]" -c:v libx264 -crf 19 -preset slow \
-c:a aac -b:a 192k output_retimed.mp4
```

#### Parameter Breakdown:
- `setpts=PTS/1.014`: Compresses video presentation timestamps by $1.4\%$.
  - A 30.0-second video becomes 29.58 seconds.
  - This difference is imperceptible to viewers, but it alters keyframe placement, shifts all temporal hash sample timestamps, and desynchronizes video-level DTW sequence matching.
- `fps=fps=30:round=near`: Normalizes variable frame rate (VFR) footage to constant frame rate (CFR 30.000 fps), eliminating container-level jitter fingerprints.
- `atempo=1.014`: Adjusts audio speed via WSOLA (Waveform Similarity Overlap-Add), preserving audio pitch while remaining synchronized with the video stream.

---

### 3.5 The Unified Production "Master Filtergraph"

The following command combines all enhancement modules into a single filtergraph pipeline.

```bash
ffmpeg -y -i input.mp4 -filter_complex \
"[0:v]setpts=PTS/1.012, \
 scale=w='trunc(iw*1.016/2)*2':h='trunc(ih*1.016/2)*2':flags=lanczos, \
 crop=w='trunc(in_w/1.016/2)*2':h='trunc(in_h/1.016/2)*2', \
 lenscorrection=cx=0.5:cy=0.5:k1=-0.003:k2=0.0008, \
 curves=master='0/0 0.25/0.24 0.5/0.505 0.75/0.762 1/1':red='0/0 0.5/0.506 1/1':blue='0/0 0.5/0.494 1/1', \
 eq=contrast=1.02:saturation=1.03:gamma=0.995[v_mod]; \
 [v_mod]split=2[v_base][v_noise_src]; \
 [v_noise_src]format=gray,noise=alls=11:allf=t+u,avgblur=sizeX=2:sizeY=2[v_grain]; \
 [v_base][v_grain]blend=all_mode=overlay:all_opacity=0.30, \
 fps=fps=30:round=near,format=yuv420p[outv]; \
 [0:a]atempo=1.012[outa]" \
-map "[outv]" -map "[outa]" \
-c:v libx264 -crf 18 -preset slow -tune film -x264-params "aq-mode=3:aq-strength=0.9:psy-rd=1.0,0.15" \
-c:a aac -b:a 192k -ar 44100 -movflags +faststart output_master.mp4
```

#### Encoder & Container Optimizations:
- `-tune film`: Optimizes x264 rate-distortion curves for film grain retention, preventing deblocking filters from smoothing out injected sensor noise.
- `-x264-params "aq-mode=3:aq-strength=0.9:psy-rd=1.0,0.15"`:
  - `aq-mode=3`: Auto-variance AQ with bias towards dark scenes, preventing blocking artifacts in shadows.
  - `psy-rd=1.0,0.15`: Psychovisual optimization preserving fine texture.
- `-movflags +faststart`: Relocates the `moov` atom to the front of the file, enabling streaming on social platforms.
