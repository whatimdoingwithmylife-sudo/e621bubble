'use strict';

document.addEventListener('DOMContentLoaded', () => {

    const E621_API_URL = 'https://e621.net/posts.json';
    const PUBLIC_PROXY_URL = 'https://corsproxy.io/?url=';
    const IMAGE_LOAD_TIMEOUT_MS = 25000;
    const GIF_GENERATE_TIMEOUT_MS = 60000;
    const MAX_CANVAS_WIDTH = 600;
    const MASK_IMAGE_SOURCE = 'src/image.png';
    const TRANSPARENT_COLOR_RGB = { r: 0, g: 255, b: 0 };
    const TRANSPARENT_COLOR_HEX_VALUE = 0x00FF00;
    const USER_AGENTS = [ "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0" ];

    const tagsInput = document.getElementById('tagsInput');
    const ratingSelect = document.getElementById('ratingSelect');
    const fetchButton = document.getElementById('fetchButton');
    const loader = document.getElementById('loader');
    const resultArea = document.getElementById('resultArea');
    const gifCanvas = document.getElementById('gifCanvas');
    const imageInfo = document.getElementById('imageInfo');
    const copyButton = document.getElementById('copyButton');
    const downloadButton = document.getElementById('downloadButton');

    let generatedGifBlob = null;
    let isFetching = false;
    let imageLoadTimeoutId = null;
    let gifGenerateTimeoutId = null;
    let maskLoaded = false;
    const maskImage = new Image();

    function showMessage(message, type = 'info') {
        console.log(`Toast (${type}): ${message}`);
        if (typeof Sonner !== 'undefined' && typeof Sonner.success === 'function') {
             switch (type) {
                 case 'success': Sonner.success(message); break;
                 case 'error': Sonner.error(message); break;
                 case 'warning': Sonner.warning(message); break;
                 default: Sonner.info(message); break;
             }
        } else {
             alert(`(${type.toUpperCase()}) ${message}`);
        }
    }

    function setLoading(isLoading) {
        isFetching = isLoading;
        loader.hidden = !isLoading;
        fetchButton.disabled = isLoading;
        fetchButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        copyButton.hidden = true;
        downloadButton.hidden = true;

        if (!isLoading) {
            copyButton.hidden = !generatedGifBlob;
            downloadButton.hidden = !generatedGifBlob;
            if (imageLoadTimeoutId) clearTimeout(imageLoadTimeoutId);
            if (gifGenerateTimeoutId) clearTimeout(gifGenerateTimeoutId);
            imageLoadTimeoutId = null;
            gifGenerateTimeoutId = null;
        }
    }

    function clearResult() {
        resultArea.hidden = true;
        imageInfo.innerHTML = '<small>Image info shows up here.</small>';
        copyButton.hidden = true;
        downloadButton.hidden = true;
        generatedGifBlob = null;
        try {
            const ctx = gifCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, gifCanvas.width, gifCanvas.height);
        } catch (e) { console.error("Oops, error clearing canvas:", e); }
        gifCanvas.width = 1;
        gifCanvas.height = 1;
    }

    function ensureMaskLoaded() {
        return new Promise((resolve, reject) => {
            if (maskLoaded && maskImage.complete && maskImage.naturalWidth > 0) {
                resolve();
                return;
            }
            if (!MASK_IMAGE_SOURCE) {
                reject(new Error("Whoops, the mask image source isn't set."));
                return;
            }
            console.log(`Loading mask image: ${MASK_IMAGE_SOURCE}`);
            maskImage.onload = () => {
                maskImage.decode().then(() => {
                    console.log("Mask loaded & decoded.");
                    maskLoaded = true;
                    resolve();
                }).catch(decodeError => reject(new Error(`Mask decoding failed: ${decodeError.message}`)));
            };
            maskImage.onerror = () => {
                maskLoaded = false;
                reject(new Error(`Drats! Failed loading mask: ${MASK_IMAGE_SOURCE}`));
            };
            maskImage.src = MASK_IMAGE_SOURCE;
        });
    }

    function getRandomUserAgent() {
        if (!USER_AGENTS || USER_AGENTS.length === 0) return "Mozilla/5.0 (compatible; E621MaskMaker/1.0)";
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    async function fetchRandomImage() {
         if (isFetching) return;
         setLoading(true);
         clearResult();

         try {
             await ensureMaskLoaded();
         } catch (maskError) {
             showMessage(`Whoops! Couldn't load the mask image: ${maskError.message}. Can't make the GIF without it!`, 'error');
             setLoading(false);
             return;
         }

         const tags = tagsInput.value.trim();
         const rating = ratingSelect.value;
         const searchTags = `order:random rating:${rating} ${tags}`.trim();
         const userAgent = getRandomUserAgent();

         if (!PUBLIC_PROXY_URL) {
             showMessage('Uh oh, the proxy URL is missing. Fetching might not work.', 'error');
             setLoading(false);
             return;
         }

         console.log(`Fetching with tags: ${searchTags}`);
         try {
             const response = await fetch(`${E621_API_URL}?tags=${encodeURIComponent(searchTags)}&limit=1`, {
                 method: 'GET',
                 headers: { 'User-Agent': userAgent }
             });

             if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
             const data = await response.json();

             if (!data.posts?.length) throw new Error('No posts found for these tags/rating. Try different tags!');
             const post = data.posts[0];

             const allowedFormats = ['jpg', 'jpeg', 'png', 'gif'];
             if (!post.file?.url || !allowedFormats.includes(post.file.ext?.toLowerCase())) {
                 throw new Error(`Unsupported file format (${post.file.ext || 'N/A'}) or missing URL.`);
             }

             if (post.file.ext.toLowerCase() === 'gif') {
                 showMessage('Got a GIF! Just using the first frame, FYI.', 'info');
             }

             await loadImageAndGenerateGif(post.file.url, post.file.width, post.file.height, post.id);

         } catch (error) {
             console.error('Fetch/Validation Error:', error);
             showMessage(`Dang, couldn't fetch an image: ${error.message}`, 'error');
             setLoading(false);
         }
    }

    async function loadImageAndGenerateGif(imageUrl, imgWidth, imgHeight, postId) {
         const ctx = gifCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
         if (!ctx) {
             showMessage("Couldn't get the canvas ready for drawing.", "error");
             setLoading(false);
             return;
         }

         let canvasWidth = imgWidth;
         let canvasHeight = imgHeight;
         if (canvasWidth > MAX_CANVAS_WIDTH) {
             const ratio = MAX_CANVAS_WIDTH / canvasWidth;
             canvasWidth = MAX_CANVAS_WIDTH;
             canvasHeight *= ratio;
         }
         canvasWidth = Math.round(canvasWidth);
         canvasHeight = Math.round(canvasHeight);

         gifCanvas.width = canvasWidth;
         gifCanvas.height = canvasHeight;
         ctx.clearRect(0, 0, canvasWidth, canvasHeight);

         const img = new Image();
         img.crossOrigin = 'anonymous';
         const proxiedImageUrl = `${PUBLIC_PROXY_URL}${encodeURIComponent(imageUrl)}`;

         imageLoadTimeoutId = setTimeout(() => {
             img.onload = img.onerror = null;
             img.src = '';
             showMessage(`Image took too long to load (Post ${postId}). Proxy or e6 might be slow.`, 'error');
             imageInfo.innerHTML = `<small>Timeout loading post ID: ${postId}.</small>`;
             resultArea.hidden = false;
             setLoading(false);
         }, IMAGE_LOAD_TIMEOUT_MS);

         img.onload = async () => {
             if (imageLoadTimeoutId) clearTimeout(imageLoadTimeoutId);
             imageLoadTimeoutId = null;
             console.log('Source image loaded.');

             let originalImageDataForRestoration = null;

             try {
                 if (!maskLoaded || !maskImage.complete || maskImage.naturalWidth === 0) {
                     throw new Error("Hold on, the mask isn't ready yet!");
                 }

                 ctx.clearRect(0, 0, canvasWidth, canvasHeight);
                 ctx.globalCompositeOperation = 'source-over';
                 const imgAspect = img.width / img.height;
                 const canvasAspect = canvasWidth / canvasHeight;
                 let sx = 0, sy = 0, sw = img.width, sh = img.height;
                 if (imgAspect > canvasAspect) {
                     sw = img.height * canvasAspect;
                     sx = (img.width - sw) / 2;
                 } else if (imgAspect < canvasAspect) {
                     sh = img.width / canvasAspect;
                     sy = (img.height - sh) / 2;
                 }
                 ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
                 console.log("Drew source.");

                 const maskAspect = maskImage.naturalHeight / maskImage.naturalWidth;
                 const maskDrawWidth = canvasWidth;
                 const maskDrawHeight = maskDrawWidth * maskAspect;
                 ctx.globalCompositeOperation = 'destination-out';
                 ctx.drawImage(maskImage, 0, 0, maskDrawWidth, maskDrawHeight);
                 ctx.globalCompositeOperation = 'source-over';
                 console.log("Applied mask.");

                 try {
                    originalImageDataForRestoration = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
                    console.log("Saved visual data for restore.");
                 } catch (getImageDataError) {
                     console.warn("Couldn't save image data for restoring the preview. Canvas might stay green.", getImageDataError);
                     originalImageDataForRestoration = null;
                 }

                 let imageDataForGif = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
                 let pixels = imageDataForGif.data;
                 let modifiedPixelCount = 0;
                 console.log("Processing pixels to force transparency color...");
                 for (let i = 0; i < pixels.length; i += 4) {
                     const alpha = pixels[i + 3];
                     if (alpha < 255) {
                         pixels[i]     = TRANSPARENT_COLOR_RGB.r;
                         pixels[i + 1] = TRANSPARENT_COLOR_RGB.g;
                         pixels[i + 2] = TRANSPARENT_COLOR_RGB.b;
                         pixels[i + 3] = 255;
                         modifiedPixelCount++;
                     }
                 }
                 console.log(`Processed ${modifiedPixelCount} pixels for transparency.`);
                 ctx.putImageData(imageDataForGif, 0, 0);
                 console.log("Applied green data to canvas for GIF generator.");

                 imageInfo.innerHTML = `<small>Post: <a href="https://e621.net/posts/${postId}" target="_blank" rel="noopener noreferrer">${postId}</a> | Orig: ${imgWidth}x${imgHeight} | Canvas: ${canvasWidth}x${canvasHeight}</small>`;
                 resultArea.hidden = false;

                 await generateGifFromCanvas(ctx, originalImageDataForRestoration);

             } catch (drawError) {
                 console.error('Canvas processing error:', drawError);
                 showMessage(`Problem drawing or masking the image: ${drawError.message}`, 'error');
                 setLoading(false);
             }
         };

         img.onerror = () => {
             if (imageLoadTimeoutId) clearTimeout(imageLoadTimeoutId);
             imageLoadTimeoutId = null;
             showMessage(`Couldn't load image for Post ${postId}. Check proxy or if the image exists.`, 'error');
             imageInfo.innerHTML = `<small>Load error for post ID: ${postId}. Couldn't fetch via proxy.</small>`;
             resultArea.hidden = false;
             setLoading(false);
         };

         showMessage('Fetching the image via proxy...', 'info');
         console.log('Loading via proxy:', proxiedImageUrl);
         img.src = proxiedImageUrl;
    }

    async function generateGifFromCanvas(ctx, originalImageDataForRestoration = null) {
        console.log("Starting GIF generation...");
        const currentCanvas = ctx.canvas;
        const workerScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';
        let workerBlobUrl = null;
        let gifInstance = null;
        let gifProcessingFinished = false;

        gifGenerateTimeoutId = setTimeout(() => {
            if (gifProcessingFinished) return;
            console.error(`GIF generation timed out after ${GIF_GENERATE_TIMEOUT_MS}ms.`);
            gifProcessingFinished = true;
            if (gifInstance) { try { gifInstance.abort(); } catch(e){} try {gifInstance.removeAllListeners();} catch(e){} }
            if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
            showMessage(`Making the GIF timed out. Image might be too complex/large, or the GIF library hung up. Try again?`, 'error');
            if (originalImageDataForRestoration) {
                try { ctx.putImageData(originalImageDataForRestoration, 0, 0); console.log("Restored preview after timeout."); } catch(e){}
            }
            setLoading(false);
        }, GIF_GENERATE_TIMEOUT_MS);

        try {
            const response = await fetch(workerScriptUrl);
            if (!response.ok) throw new Error(`Failed to fetch gif.worker.js: ${response.status}`);
            const workerScriptText = await response.text();
            const blob = new Blob([workerScriptText], { type: 'application/javascript' });
            workerBlobUrl = URL.createObjectURL(blob);
            console.log("Worker Blob URL ready.");

            showMessage('Making the magic GIF (hang tight)...', 'info');

            gifInstance = new GIF({
                workers: navigator.hardwareConcurrency || 2,
                quality: 5, // Balance between quality (1=best) and speed (10=fastest)
                width: currentCanvas.width,
                height: currentCanvas.height,
                workerScript: workerBlobUrl,
                transparent: TRANSPARENT_COLOR_HEX_VALUE,
                background: TRANSPARENT_COLOR_HEX_VALUE
            });

            const cleanup = (restoreCanvas = false) => {
                if (gifProcessingFinished) return;
                gifProcessingFinished = true;
                clearTimeout(gifGenerateTimeoutId);
                gifGenerateTimeoutId = null;
                if (workerBlobUrl) { URL.revokeObjectURL(workerBlobUrl); console.log('Cleaned up worker URL.'); }

                if (restoreCanvas && originalImageDataForRestoration) {
                    try {
                       ctx.putImageData(originalImageDataForRestoration, 0, 0);
                       console.log("Restored original preview to canvas.");
                    } catch(putError) {
                        console.error("Failed to restore canvas preview after GIF generation", putError);
                        showMessage("Note: Couldn't quite tidy up the preview image.", "warning");
                    }
                } else if (restoreCanvas) {
                     console.log("Skipping canvas preview restoration (no data or not needed).");
                }
            };

            gifInstance.on('finished', (gifBlob) => {
                if (gifProcessingFinished) return;
                console.log("GIF finished!");
                cleanup(true);
                generatedGifBlob = gifBlob;
                copyButton.hidden = false;
                downloadButton.hidden = false;
                showMessage('Boom! Masked GIF ready!', 'success');
                setLoading(false);
            });

            gifInstance.on('error', (err) => {
                if (gifProcessingFinished) return;
                console.error('GIF Generation Error:', err);
                cleanup(true);
                showMessage('Hmm, something went wrong making the GIF.', 'error');
                setLoading(false);
            });

            console.log('Added frame with forced transparency color, starting render...');
            gifInstance.addFrame(ctx, { delay: 200, copy: true });
            gifInstance.render();

        } catch (error) {
             console.error('GIF Setup/Fetch Error:', error);
             if (!gifProcessingFinished) {
                 gifProcessingFinished = true;
                 clearTimeout(gifGenerateTimeoutId);
                 gifGenerateTimeoutId = null;
                 if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
                 if (originalImageDataForRestoration) {
                    try { ctx.putImageData(originalImageDataForRestoration, 0, 0); console.log("Restored preview after setup error."); }
                    catch (e) { console.error("Failed canvas restore after setup error:", e); }
                 }
             }
             showMessage(`Couldn't get the GIF maker started: ${error.message}`, 'error');
             setLoading(false);
        }
    }

    async function copyGifToClipboard() {
        if (!generatedGifBlob) {
            showMessage("Nothin' to copy yet!", 'warning');
            return;
        }
        if (!navigator.clipboard?.write) {
             showMessage("Can't copy to clipboard (browser says no or doesn't support it). Try downloading!", 'error');
             return;
         }
        try {
             const gifBlobForCopy = new Blob([generatedGifBlob], { type: 'image/gif' });
             await navigator.clipboard.write([ new ClipboardItem({ 'image/gif': gifBlobForCopy }) ]);
             showMessage('Copied!', 'success');
        } catch (error) {
             console.error('Copy GIF failed:', error);
             const msg = error.name === 'NotAllowedError' ? 'Clipboard permission denied by browser.' : `Copy failed: ${error.message}`;
             showMessage(msg, 'error');
        }
    }

    function downloadGif() {
         if (!generatedGifBlob) {
             showMessage('No GIF to download yet!', 'warning');
             return;
         }
         try {
            const url = URL.createObjectURL(generatedGifBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;

            let postId = 'unknown';
            const linkElement = imageInfo.querySelector('a');
            if (linkElement) {
                 const match = linkElement.href.match(/posts\/(\d+)/);
                 if (match && match[1]) postId = match[1];
            } else {
                const textMatch = imageInfo.textContent.match(/Post: (\d+)/);
                if (textMatch && textMatch[1]) postId = textMatch[1];
            }

            a.download = `e621-masked-${postId}-${Date.now()}.gif`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showMessage('Download started!', 'info');
            }, 250);
         } catch (error) {
            console.error("Download initiation failed:", error);
            showMessage("Couldn't create the download link.", "error");
         }
    }

    function initializeApp() {
        console.log("DOM ready, firing up...");
        if (typeof Sonner !== 'undefined' && typeof Sonner.init === 'function') {
             Sonner.init({ position: 'top-right', richColors: true });
             console.log("Sonner initialized.");
        } else if (typeof Sonner !== 'undefined' && typeof toast === 'function') {
             window.Sonner = { success: (msg, opts) => toast.success(msg, opts), error: (msg, opts) => toast.error(msg, opts), info: (msg, opts) => toast.info(msg, opts), warning: (msg, opts) => toast.warning(msg, opts) };
             console.log("Sonner loaded as 'toast', created wrapper.");
        } else {
             console.warn("Sonner notification library not found or initialized. Using basic alerts.");
        }

        if (!fetchButton || !copyButton || !downloadButton || !tagsInput || !ratingSelect || !loader || !resultArea || !gifCanvas || !imageInfo) {
             showMessage("Yikes! Key page parts are missing! Things might be broken.", "error");
             return;
        }

        fetchButton.addEventListener('click', fetchRandomImage);
        copyButton.addEventListener('click', copyGifToClipboard);
        downloadButton.addEventListener('click', downloadGif);

        if (!PUBLIC_PROXY_URL) {
            showMessage('Heads up: Proxy URL is not set, fetching might fail.', 'warning');
        }

        ensureMaskLoaded()
            .then(() => {
                showMessage('Mask image ready.', 'info');
            })
            .catch(maskError => {
                showMessage(`Initial mask load failed: ${maskError.message}. Generation won't work. Check if image.png exists!`, 'error');
                fetchButton.disabled = true;
                fetchButton.textContent = "Mask Load Error";
            });

        console.log("App initialized.");
    }

    initializeApp();

}); // End DOMContentLoaded