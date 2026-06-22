// Local Gemini Exporter - Content Script
// Analyzes the DOM and injects local download triggers natively without relying on external servers.

(() => {
    "use strict";

    // Inject finder.js to the main page context so it can hook XMLHttpRequest
    if (!window.__finderInjected) {
        window.__finderInjected = true;
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('css/finder.js');
        s.onload = function() {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(s);
    }
    
    function injectExportButtons() {
        // Locate all Gemini response outputs that haven't been tagged with our injected attribute yet
        const responses = document.querySelectorAll("model-response:not([data-export-injected])");
        
        responses.forEach(responseEl => {
            // Mark element so we don't duplicate injection
            responseEl.setAttribute("data-export-injected", "true");
            
            // The original action bar container at the bottom of a response
            const actionContainer = responseEl.querySelector("message-actions");
            if(actionContainer) {
                // Wrap our new buttons
                const btnGroup = document.createElement("div");
                btnGroup.className = "edu-export-group";

                // Generate Markdown Button
                const mdBtn = document.createElement("button");
                mdBtn.className = "edu-export-btn";
                mdBtn.innerHTML = `<span>📝 MD</span>`;
                mdBtn.title = "Save response locally as Markdown (.md)";
                mdBtn.onclick = () => exportToFormat(responseEl, 'md');

                // Generate Word Button
                const wordBtn = document.createElement("button");
                wordBtn.className = "edu-export-btn edu-btn-word";
                wordBtn.innerHTML = `<span>📄 Word</span>`;
                wordBtn.title = "Save response locally as Microsoft Word (.docx)";
                wordBtn.onclick = () => exportToFormat(responseEl, 'doc');

                btnGroup.appendChild(mdBtn);
                btnGroup.appendChild(wordBtn);
                
                // Append directly into the Gemini action tray
                actionContainer.appendChild(btnGroup);
            }
        });
    }

    function fallbackDOMToMarkdown(node) {
        if (!node) return "";
        let text = "";
        for (let i = 0; i < node.childNodes.length; i++) {
            let child = node.childNodes[i];
            if (child.nodeType === 3) {
                text += child.textContent;
            } else if (child.nodeType === 1) {
                // KaTeX Math
                if (child.classList && child.classList.contains('katex-mathml')) {
                     const annotation = child.querySelector('annotation[encoding="application/x-tex"]');
                     if (annotation) {
                         // Determine if display mode by checking if it's in a block container
                         let isBlock = false;
                         let curr = child;
                         while(curr && curr !== node) {
                             if((curr.tagName === 'DIV' && curr.style && curr.style.textAlign === 'center') || (curr.classList && curr.classList.contains('math-block'))) {
                                 isBlock = true; break;
                             }
                             curr = curr.parentElement;
                         }
                         if (isBlock) text += "\n$$" + annotation.textContent.trim() + "$$\n";
                         else text += "$" + annotation.textContent.trim() + "$";
                         continue;
                     }
                }
                if (child.classList && child.classList.contains('katex-html')) {
                     continue; 
                }
                
                if (child.tagName === 'P' || child.tagName === 'DIV' || child.tagName === 'LI') {
                     let innerText = fallbackDOMToMarkdown(child);
                     text += innerText + (child.tagName === 'LI' ? "\n" : "\n\n");
                } else if (child.tagName === 'BR') {
                     text += "\n";
                } else {
                     text += fallbackDOMToMarkdown(child);
                }
            }
        }
        return text.replace(/\n{3,}/g, '\n\n').trim();
    }

    async function fetchRawMarkdown(element) {
        // Find the closest ID that looks like a conversation block ID
        let container = element.closest('[id^="r_"], [id^="c_"], div.conversation-container[id]');
        if (!container) return "";
        let turnId = container.id;

        return new Promise((resolve, reject) => {
            const callId = "call_" + Math.random().toString(36).substr(2, 9);
            const listener = (event) => {
                if (event.source === window && event.data && event.data.type === "PAGE_FUNCTION_RESULT" && event.data.callId === callId) {
                    window.removeEventListener("message", listener);
                    if (event.data.error) reject(new Error(event.data.error));
                    else {
                        let result = event.data.result;
                        if (Array.isArray(result) && result.length > 0) {
                            // Extract the response text
                            let responseText = result[result.length - 1].response || "";
                            resolve(responseText);
                        } else {
                            resolve("");
                        }
                    }
                }
            };
            window.addEventListener("message", listener);
            window.postMessage({
                type: "CALL_PAGE_FUNCTION",
                functionName: "getSingleConversation",
                args: [turnId],
                callId: callId
            }, "*");
        });
    }

    function getSuggestedFilename(userText) {
        let title = "Gemini-Export";
        if (document.title && document.title !== "Gemini" && !document.title.includes("New chat")) {
            title = document.title.replace(" - Gemini", "").trim();
        } else if (userText) {
            title = userText.substring(0, 40).trim();
        }
        title = title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s]/g, " ")
                     .replace(/\s+/g, "_")
                     .substring(0, 40)
                     .trim()
                     .replace(/_$/, "");
        if (!title) title = "Gemini-Export";
        const dateStr = new Date().toISOString().slice(0, 10);
        return `${title}_${dateStr}`;
    }

    function svgToPngBase64(svgElement) {
        return new Promise((resolve) => {
            try {
                const clone = svgElement.cloneNode(true);
                if (!clone.getAttribute('xmlns')) {
                    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
                let svgString = new XMLSerializer().serializeToString(clone);
                const svg64 = btoa(unescape(encodeURIComponent(svgString)));
                const b64Start = 'data:image/svg+xml;base64,';
                const image64 = b64Start + svg64;

                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width || 800;
                    canvas.height = img.height || 600;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = "white";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = function() {
                    resolve(null);
                };
                img.src = image64;
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function extractChartsFromNode(node) {
        const charts = [];
        const svgs = node.querySelectorAll('svg');
        for (let i = 0; i < svgs.length; i++) {
            const svg = svgs[i];
            const width = svg.clientWidth || (svg.getBoundingClientRect && svg.getBoundingClientRect().width) || 0;
            const height = svg.clientHeight || (svg.getBoundingClientRect && svg.getBoundingClientRect().height) || 0;
            const isLarge = width > 100 || height > 100;
            const hasText = svg.querySelector('text') !== null;
            const hasG = svg.querySelector('g') !== null;
            const isMermaid = svg.classList.contains('mermaid') || (svg.id && svg.id.includes('mermaid'));
            
            if ((isLarge && (hasG || hasText)) || isMermaid) {
                const b64 = await svgToPngBase64(svg);
                if (b64) charts.push(b64);
            }
        }
        return charts;
    }

    async function exportToFormat(node, format) {
        const oldCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';

        try {
            let rawContent = await fetchRawMarkdown(node);
            
            // Fallback to basic DOM extraction if XHR hooking failed (e.g., page loaded before extension)
            if (!rawContent) {
                const markdownNode = node.querySelector('.markdown');
                if (markdownNode) rawContent = fallbackDOMToMarkdown(markdownNode);
            }

            if (!rawContent) {
                alert("No content available to export. (Refresh the page and chat again so the extension can hook the data stream).");
                document.body.style.cursor = oldCursor;
                return;
            }
            
            // Remove Gemini citation tags like [cite_start] and [cite_end]
            rawContent = rawContent.replace(/\[cite[^\]]*\]/g, '');
            
            const charts = await extractChartsFromNode(node);
            for (let i = 0; i < charts.length; i++) {
                rawContent += `\n\n![Chart](${charts[i]})\n\n`;
            }
            
            let userText = "";
            let blockData = await fetchBlockData(node);
            if (blockData) {
                userText = blockData.request || "";
            } else {
                const container = node.closest('div.conversation-container');
                let queryEl = container ? container.previousElementSibling : null;
                if(queryEl && queryEl.querySelector) {
                    const userTextEl = queryEl.querySelector('[data-mime-type="text/plain"], .query-text, .user-query-text');
                    if(userTextEl) userText = userTextEl.innerText;
                }
            }

            // Tạo file trực tiếp từ trình duyệt
const blob = new Blob([fullDocumentMarkdown], { type: 'text/markdown;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = getSuggestedFilename(firstUserText) + "_All.md"; // Tải về đuôi .md

// Kích hoạt tải xuống
document.body.appendChild(a);
a.click();

// Dọn dẹp và phục hồi giao diện
document.body.removeChild(a);
URL.revokeObjectURL(url);
document.body.style.cursor = oldCursor;
btn.innerHTML = originalText;
btn.style.pointerEvents = 'auto';
btn.onclick = exportAllToWord;
        } catch (e) {
            console.error("Failed to fetch raw markdown:", e);
            document.body.style.cursor = oldCursor;
            alert("Error fetching content.");
        }
    }

    // Set up a MutationObserver to listen for DOM changes (React renders)
    // This catches new AI answers automatically as they stream in
    const observer = new MutationObserver(() => {
        injectExportButtons();
        injectExportAllButton();
    });
    
    function injectExportAllButton() {
        if (document.getElementById('edu-export-all-btn')) return;
        
        const floatBtn = document.createElement('button');
        floatBtn.id = 'edu-export-all-btn';
        floatBtn.type = 'button';
        floatBtn.innerHTML = `<span>🚀 Export All to Word</span>`;
        floatBtn.title = 'Auto-scrolls to load all chat history and exports to Word';
        floatBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            background-color: #1a73e8;
            color: white;
            border: none;
            border-radius: 20px;
            padding: 10px 20px;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background-color 0.2s, transform 0.1s;
        `;
        floatBtn.onmouseover = () => floatBtn.style.backgroundColor = '#1557b0';
        floatBtn.onmouseout = () => floatBtn.style.backgroundColor = '#1a73e8';
        floatBtn.onmousedown = () => floatBtn.style.transform = 'scale(0.95)';
        floatBtn.onmouseup = () => floatBtn.style.transform = 'scale(1)';
        
        floatBtn.onclick = exportAllToWord;
        document.body.appendChild(floatBtn);
    }

    async function autoScrollToTop(checkForceStop) {
        return new Promise(resolve => {
            let lastMetric = "";
            let unchangedCount = 0;

            const interval = setInterval(() => {
                try {
                    if (checkForceStop && checkForceStop()) {
                        clearInterval(interval);
                        return resolve();
                    }

                    const scrollable = [document.documentElement, document.body];
                    const allContainers = document.querySelectorAll('message-list, main, [role="main"], div.conversation-container, div[style*="overflow"], infinite-scroller, .infinite-scroller');
                    for (let i = 0; i < allContainers.length; i++) {
                        const el = allContainers[i];
                        if (el.scrollHeight > el.clientHeight && !scrollable.includes(el)) {
                            scrollable.push(el);
                        }
                    }

                    window.scrollTo({ top: 10, behavior: 'instant' });
                    window.dispatchEvent(new Event('scroll'));
                    window.scrollTo({ top: 0, behavior: 'instant' });
                    window.dispatchEvent(new Event('scroll'));
                    
                    scrollable.forEach(target => {
                        target.scrollTop = 10;
                        target.dispatchEvent(new Event('scroll'));
                        target.scrollTop = 0;
                        target.dispatchEvent(new Event('scroll'));
                    });
                    
                    setTimeout(() => {
                        try {
                            const allMsgs = document.querySelectorAll('model-response, user-query, current-user-message, .conversation-container');
                            let currentMetric = "total:" + allMsgs.length;
                            
                            if (allMsgs.length > 0) {
                                currentMetric += "_topContent:" + allMsgs[0].textContent.substring(0, 80).trim();
                            }

                            if (currentMetric === lastMetric) {
                                unchangedCount++;
                                if (unchangedCount > 5) { // Wait roughly 5 seconds of NO new messages added
                                    clearInterval(interval);
                                    resolve();
                                }
                            } else {
                                lastMetric = currentMetric;
                                unchangedCount = 0;
                            }
                        } catch(e) {
                            clearInterval(interval);
                            resolve();
                        }
                    }, 200);
                } catch(e) {
                    clearInterval(interval);
                    resolve();
                }
            }, 800);
        });
    }

    async function fetchBlockData(element) {
        let container = element.closest('[id^="r_"], [id^="c_"], div.conversation-container[id]');
        if (!container) return null;
        let turnId = container.id;

        return new Promise((resolve) => {
            const callId = "call_" + Math.random().toString(36).substr(2, 9);
            const listener = (event) => {
                if (event.source === window && event.data && event.data.type === "PAGE_FUNCTION_RESULT" && event.data.callId === callId) {
                    window.removeEventListener("message", listener);
                    if (event.data.error) resolve(null);
                    else resolve(event.data.result);
                }
            };
            window.addEventListener("message", listener);
            window.postMessage({
                type: "CALL_PAGE_FUNCTION",
                functionName: "getSingleConversationBlock",
                args: [turnId],
                callId: callId
            }, "*");
        });
    }

    async function exportAllToWord() {
        const btn = document.getElementById('edu-export-all-btn');
        const originalText = btn.innerHTML;
        
        let forceStop = false;
        btn.innerHTML = `<span>🛑 Đang cuộn... Click để dừng & tải</span>`;
        btn.style.pointerEvents = 'auto'; // allow clicking to stop
        btn.title = 'Đang cuộn lên trên cùng... Click để dừng và tải xuống dữ liệu hiện tại ngay lập tức.';
        
        const stopHandler = (e) => {
            e.stopPropagation();
            forceStop = true;
            btn.innerHTML = `<span>⚙️ Đang xử lý...</span>`;
            btn.onclick = null;
        };
        btn.onclick = stopHandler;
        
        const oldCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';

        try {
            await autoScrollToTop(() => forceStop);
            
            btn.innerHTML = `<span>⚙️ Processing...</span>`;
            
            // Gather all responses visually on screen in order from top to bottom
            const responses = Array.from(document.querySelectorAll("model-response"));
            if (responses.length === 0) {
                alert("No conversation found.");
                return;
            }

            let fullDocumentMarkdown = "# Gemini Chat Export\\n\\n";
            let firstUserText = "";
            
            for (const responseEl of responses) {
                // Fetch the API data matching this element
                const blockData = await fetchBlockData(responseEl);
                let userText = "";
                let modelText = "";
                
                if (blockData) {
                    userText = blockData.request || "";
                    modelText = blockData.response || "";
                } else {
                    // Fallback to DOM parsing just in case
                    const markdownNode = responseEl.querySelector('.markdown');
                    if (markdownNode) modelText = fallbackDOMToMarkdown(markdownNode);
                    
                    // Attempt to find user query in DOM before this responseEl
                    const container = responseEl.closest('div.conversation-container');
                    let queryEl = container ? container.previousElementSibling : null;
                    if(queryEl && queryEl.querySelector) {
                         const userTextEl = queryEl.querySelector('[data-mime-type="text/plain"], .query-text, .user-query-text');
                         if(userTextEl) userText = userTextEl.innerText;
                    }
                }
                
                if (userText && !firstUserText) {
                    firstUserText = userText;
                }
                
                if (userText) {
                    fullDocumentMarkdown += `**User:**\\n${userText}\\n\\n`;
                }
                
                // Remove Gemini citation tags
                if (modelText) {
                    modelText = modelText.replace(/\[cite[^\]]*\]/g, '');
                }

                const charts = await extractChartsFromNode(responseEl);
                for (let i = 0; i < charts.length; i++) {
                    modelText += `\n\n![Chart](${charts[i]})\n\n`;
                }

                if (modelText) {
                    fullDocumentMarkdown += `**Gemini:**\\n${modelText}\\n\\n---\\n\\n`;
                }
            }

            chrome.runtime.sendMessage({ 
                action: "download", 
                type: "doc",
                filename: getSuggestedFilename(firstUserText) + "_All",
                content: fullDocumentMarkdown
            }, function(response) {
                document.body.style.cursor = oldCursor;
                btn.innerHTML = originalText;
                btn.title = 'Auto-scrolls to load all chat history and exports to Word';
                btn.style.pointerEvents = 'auto';
                btn.onclick = exportAllToWord;
                if (chrome.runtime.lastError) {
                    console.error("Export error:", chrome.runtime.lastError.message);
                }
            });
        } catch (e) {
            console.error("Failed to export all:", e);
            btn.innerHTML = originalText;
            btn.title = 'Auto-scrolls to load all chat history and exports to Word';
            btn.style.pointerEvents = 'auto';
            btn.onclick = exportAllToWord;
            document.body.style.cursor = oldCursor;
            alert("Error exporting full chat.");
        }
    }

    // Process existing DOM on page load
    injectExportButtons();
    injectExportAllButton();

    
    // Lock it onto the body and observe deeply nested mutations
    observer.observe(document.body, { childList: true, subtree: true });
})();
