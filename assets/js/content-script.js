class ContentScript {
  static lazyImgs = [];
  static lazyTries = [];
  static scrollables = [];
  static scrollableIndex = 0;
  static rtl = false;
  // Safety backstop (px) applied only in "Unlimited" mode (max_scrolling === 0).
  // In "Limited" mode the user-configured max (capped at 15000 in the popup) is used instead.
  static oxyplugScrollLimit = 50000;

  /**
   * Init
   * @returns {Promise<void>}
   */
  static async init() {
    ContentScript.issues = {};

    // Reset data after closing the browser/tab
    window.addEventListener('unload', async () => {
      await Common.setLocalStorage({is_processing: false, stopped: true, processingOn: null});
    });

    // Add listener
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'oxyplug-tech-seo-audit') {
        port.onMessage.addListener((request) => {
          new Promise(async (resolve) => {
            if (request.start === true) {
              await ContentScript.startAnalyzing();
              await Common.setLocalStorage({processingOn: null});
            } else if (request.reload === true) {
              location.reload();
            } else if (request.scrollTo) {
              await ContentScript.scrollToPoint(request);
            } else if (request.messages) {
              await ContentScript.postMessage({
                showIssues: request.messages,
                issueTypes: request.issueTypes
              });
            } else if (request.newXColor) {
              await ContentScript.setXColor(request);
            } else if (request.newXColorAll) {
              await ContentScript.setXColorAll(request);
            }

            resolve();
            return true;
          });
        });
      }
    });
  }

  /**
   * Post message
   * @param data
   * @returns {Promise<void>}
   */
  static async postMessage(data) {
    ContentScript.port = chrome.runtime.connect({name: 'oxyplug-tech-seo-audit'});
    ContentScript.port.postMessage(data);
  }

  /**
   * Mark lazy images to make them load
   * @param imgs
   * @returns {Promise<void>}
   */
  static async markLazies(imgs) {
    return new Promise(async (resolve, reject) => {
      await Common.log('Marking lazy images to be checked...');
      try {
        ContentScript.lazyImgs = [];
        ContentScript.lazyTries = [];
        for (const [index, img] of Object.entries(imgs)) {
          const naturalWidth = parseInt(img.dataset.naturalWidth) || 0;
          const naturalHeight = parseInt(img.dataset.naturalHeight) || 0;
          if (
            ((naturalWidth == 0 || naturalHeight == 0) || (naturalWidth == 1 && naturalHeight == 1)) &&
            !Audit.loadFailsList[img.src]
          ) {
            const lazyImgClass = `oxyplug-tech-seo-lazy-${index}`;
            img.addEventListener('load', () => {
              if (img.complete) {
                ContentScript.lazyImgs = ContentScript.lazyImgs.filter(lazyImg => !lazyImg.hasOwnProperty(lazyImgClass));
              }
            });

            if (img.hasAttribute('loading')) {
              img.dataset.hasLoading = img.getAttribute('loading');
            } else {
              img.dataset.hasLoading = 'no';
            }
            img.setAttribute('loading', 'eager');
            img.classList.add(lazyImgClass);
            ContentScript.lazyImgs.push({[lazyImgClass]: img});
          }
        }

        if (ContentScript.lazyImgs.length) {
          await Common.log('Marked lazy images...');
        } else {
          await Common.log('No lazy images found to be marked and checked...');
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Mark scrollables like simple carousels to scroll them and load possible lazy images
   * @returns {Promise<void>}
   */
  static async markScrollables() {
    return new Promise(async (resolve, reject) => {
      await Common.log('Marking scrollables to be scrolled to load lazy images...');

      try {
        ContentScript.scrollables = [];
        const allElements = await Common.getElements('body *:not(script, style, link, meta)');
        for (let e = 0; e < allElements.length; e++) {
          const style = getComputedStyle(allElements[e]);

          const scrollableX =
            (allElements[e].clientWidth < allElements[e].scrollWidth) &&
            (['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflow));

          const scrollableY =
            (allElements[e].clientHeight < allElements[e].scrollHeight) &&
            (['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflow));

          if (scrollableX || scrollableY) {
            let className;
            if (scrollableX) {
              className = 'oxyplug-tech-seo-scrollable-x';
            } else if (scrollableY) {
              className = 'oxyplug-tech-seo-scrollable-y';
            }

            /**
             * Element.offsetTop won't work in this scenario as we are not scrolling the whole page but a div.
             * And if we are to use getBoundingClientRect(), its value keeps changing after scrolling so at first point
             * it needs to be stored somewhere like dataset and be used afterward.
             */
            const parent = allElements[e].parentElement;
            if (parent.classList.contains('oxyplug-tech-seo-scrollable-y')) {
              const rect = allElements[e].getBoundingClientRect();
              const parentRect = allElements[e].parentElement.getBoundingClientRect();
              allElements[e].dataset.rectTop = String(rect.top - parentRect.top);
            }
            allElements[e].classList.add(className);
            ContentScript.scrollables.push(allElements[e]);
          }
        }

        if (ContentScript.scrollables.length) {
          await Common.log('Marked scrollables...');
        }

        const progress = 60;
        await ContentScript.postMessage({progress: progress});
        await Common.setLocalStorage({progress: progress});

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Load lazy images by scrolling the page
   * @returns {Promise<void>}
   */
  static async scrollPage() {
    return new Promise(async (resolve, reject) => {
      try {
        await Common.log('Scrolling the page to load lazy images...');

        const progress = 20;
        await ContentScript.postMessage({progress: progress});
        await Common.setLocalStorage({progress: progress});

        const docEl = document.documentElement;

        // Go to top to start scrolling
        window.scroll({top: 0});

        // Down
        const scrollForwardVertically = async () => {
          const stopped = await ContentScript.checkStop();
          if (stopped) return resolve(stopped);

          // Limit scrolling
          let scrollLimit = docEl.scrollHeight;
          const maxScrolling = await Common.getLocalStorage('max_scrolling');
          if (maxScrolling > 0 && maxScrolling <= scrollLimit) {
            scrollLimit = maxScrolling;
          } else if (scrollLimit > ContentScript.oxyplugScrollLimit) {
            scrollLimit = ContentScript.oxyplugScrollLimit;
          }

          const shouldContinue = docEl.clientHeight + docEl.scrollTop < scrollLimit - 1;
          if (shouldContinue) {

            // Scroll Down
            window.scrollTo({
              top: docEl.scrollTop + docEl.clientHeight,
              behavior: 'smooth'
            });

            // Wait 0.7 second
            await Common.wait(700);

            // Call function again
            await scrollForwardVertically();
          } else {
            const progress = 40;
            await ContentScript.postMessage({progress: progress});
            await Common.setLocalStorage({progress: progress});

            await scrollBackwardVertically();
          }
        };

        // Up
        const scrollBackwardVertically = async () => {
          const stopped = await ContentScript.checkStop();
          if (stopped) return resolve(stopped);

          const shouldContinue = docEl.scrollTop > 1;
          if (shouldContinue) {

            // Scroll Up
            window.scrollTo({
              top: docEl.scrollTop - docEl.clientHeight,
              behavior: 'smooth'
            });

            // Wait 0.7 second
            await Common.wait(700);

            // Call function again
            return resolve(await scrollBackwardVertically());
          }

          await Common.log('Scrolled the page...');
          resolve();
        };

        // Start scrolling
        await scrollForwardVertically();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Move the page to the point of scrollable
   * @param scrollable
   * @returns {Promise<void>}
   */
  static async gotoSection(scrollable) {
    return new Promise((resolve, reject) => {
      try {
        if (scrollable.dataset.rectTop) {
          scrollable.parentElement.scroll({
            top: Number(scrollable.dataset.rectTop),
            behavior: 'smooth'
          });
        } else {
          const scrollableY = scrollable.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, scrollableY);
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Check if there are more scrollables
   * @returns {Promise<void>}
   */
  static async moreScrollables() {
    return new Promise(async (resolve, reject) => {
      try {
        if (ContentScript.scrollables.length) {
          const nextScrollable = ContentScript.scrollables[++ContentScript.scrollableIndex];
          if (nextScrollable === undefined) {
            ContentScript.scrollables = [];
          } else {
            await ContentScript.gotoSection(nextScrollable);
            return resolve(await ContentScript.initScroll(nextScrollable));
          }
        }
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Scroll forward horizontally
   * @param scrollable
   * @param scrollEndPoint
   * @returns {Promise<unknown>}
   */
  static async scrollForwardHorizontally(scrollable, scrollEndPoint) {
    return new Promise(async (resolve) => {
      const stopped = await ContentScript.checkStop();
      if (stopped) return resolve(stopped);

      if (ContentScript.rtl) {
        const scrollableScrollLeft = Math.abs(scrollable.scrollLeft);
        if (scrollableScrollLeft < scrollEndPoint) {

          // Scroll Forward
          scrollable.scrollTo({
            left: scrollable.scrollLeft - scrollable.clientWidth,
            behavior: 'smooth'
          });

          // Wait 0.7 second
          await Common.wait(700);

          // Check if the scroll point has not changed, so ignore it since it might have LTR/RTL issue
          if (scrollableScrollLeft == Math.abs(scrollable.scrollLeft)) {
            await ContentScript.moreScrollables();
            return resolve();
          }

          // Call function again
          return resolve(await ContentScript.scrollForwardHorizontally(scrollable, scrollEndPoint));
        }
      } else {
        const scrollableScrollLeft = scrollable.scrollLeft;
        if (scrollableScrollLeft < scrollEndPoint) {
          // Scroll Forward
          scrollable.scrollTo({
            left: scrollable.scrollLeft + scrollable.clientWidth,
            behavior: 'smooth'
          });

          // Wait 0.7 second
          await Common.wait(700);

          // Check if the scroll point has not changed, so ignore it since it might have LTR/RTL issue
          if (scrollableScrollLeft == scrollable.scrollLeft) {
            await ContentScript.moreScrollables();
            return resolve();
          }

          // Call function again
          return resolve(await ContentScript.scrollForwardHorizontally(scrollable, scrollEndPoint));
        }
      }

      resolve(await ContentScript.scrollBackwardHorizontally(scrollable, 0));
    });
  }

  /**
   * Scroll backward horizontally
   * @param scrollable
   * @param scrollEndPoint
   * @returns {Promise<unknown>}
   */
  static async scrollBackwardHorizontally(scrollable, scrollEndPoint) {
    return new Promise(async (resolve) => {
      const stopped = await ContentScript.checkStop();
      if (stopped) return resolve(stopped);

      if (ContentScript.rtl) {
        if (scrollable.scrollLeft < scrollEndPoint) {

          // Scroll Backward
          scrollable.scrollTo({
            left: scrollable.scrollLeft + scrollable.clientWidth,
            behavior: 'smooth'
          });

          // Wait 0.7 second
          await Common.wait(700);

          // Call function again
          return resolve(await ContentScript.scrollBackwardHorizontally(scrollable, scrollEndPoint));
        }
      } else {
        if (scrollable.scrollLeft > scrollEndPoint) {

          // Scroll Backward
          scrollable.scrollTo({
            left: scrollable.scrollLeft - scrollable.clientWidth,
            behavior: 'smooth'
          });

          // Wait 0.7 second
          await Common.wait(700);

          // Call function again
          return resolve(await ContentScript.scrollBackwardHorizontally(scrollable, scrollEndPoint));
        }
      }

      await ContentScript.moreScrollables();

      resolve();
    });
  }

  /**
   * Scroll the scrollables horizontally
   * @param scrollable
   * @returns {Promise<void>}
   */
  static async scrollHorizontally(scrollable) {
    return new Promise(async (resolve, reject) => {
      try {
        const stopped = await ContentScript.checkStop();
        if (stopped) return resolve(stopped);

        await ContentScript.gotoSection(scrollable);

        const scrollEndPointWithTolerance = scrollable.scrollWidth - scrollable.clientWidth - 1;
        // Scroll to the start point depending on the layout
        scrollable.scrollLeft = ContentScript.rtl ? scrollEndPointWithTolerance : 0;

        resolve(await ContentScript.scrollForwardHorizontally(scrollable, scrollEndPointWithTolerance));
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Scroll forward vertically
   * @param scrollable
   * @param scrollEndPoint
   * @returns {Promise<unknown>}
   */
  static async scrollForwardVertically(scrollable, scrollEndPoint) {
    return new Promise(async (resolve) => {
      const stopped = await ContentScript.checkStop();
      if (stopped) return resolve(stopped);

      // Go to the section
      const scrollableY = scrollable.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, scrollableY);

      if (scrollable.scrollTop < scrollEndPoint) {

        // Scroll Forward
        scrollable.scrollTo({
          top: scrollable.scrollTop + scrollable.clientHeight,
          behavior: 'smooth'
        });

        // Wait 0.7 second
        await Common.wait(700);

        // Call function again
        return resolve(await ContentScript.scrollForwardVertically(scrollable, scrollEndPoint));
      }


      await ContentScript.scrollBackwardVertically(scrollable, 0);
      resolve();
    });
  }

  /**
   * Scroll backward vertically
   * @param scrollable
   * @param scrollEndPoint
   * @returns {Promise<unknown>}
   */
  static async scrollBackwardVertically(scrollable, scrollEndPoint) {
    return new Promise(async (resolve) => {
      const stopped = await ContentScript.checkStop();
      if (stopped) return resolve(stopped);

      if (scrollable.scrollTop > scrollEndPoint) {
        // Scroll Backward
        scrollable.scrollTo({
          top: scrollable.scrollTop - scrollable.clientHeight,
          behavior: 'smooth'
        });

        // Wait 0.7 second
        await Common.wait(700);

        // Call function again
        return resolve(await ContentScript.scrollBackwardVertically(scrollable, scrollEndPoint));
      }

      await ContentScript.moreScrollables();

      resolve();
    });
  }

  /**
   * Scroll the scrollables vertically
   * @param scrollable
   * @returns {Promise<void>}
   */
  static async scrollVertically(scrollable) {
    return new Promise(async (resolve, reject) => {
      try {
        const stopped = await ContentScript.checkStop();
        if (stopped) return resolve(stopped);

        await ContentScript.gotoSection(scrollable);

        const scrollEndPointWithTolerance = scrollable.scrollHeight - scrollable.clientHeight - 1;
        // Scroll to the start point
        scrollable.scrollTop = 0;
        await ContentScript.scrollForwardVertically(scrollable, scrollEndPointWithTolerance);
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Init and start scrolling scrollables
   * @param scrollable
   * @returns {Promise<void>}
   */
  static async initScroll(scrollable) {
    return new Promise(async (resolve, reject) => {
      try {
        const stopped = await ContentScript.checkStop();
        if (stopped) return resolve(stopped);

        const classList = [...scrollable.classList];
        if (classList.includes('oxyplug-tech-seo-scrollable-x')) {
          return resolve(await ContentScript.scrollHorizontally(scrollable));
        } else if (classList.includes('oxyplug-tech-seo-scrollable-y')) {
          return resolve(await ContentScript.scrollVertically(scrollable));
        }
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });

  }

  /**
   * Load lazy images by scrolling scrollable sections
   * @returns {Promise<void>}
   */
  static async scrollScrollables() {
    return new Promise(async (resolve, reject) => {
      await Common.log('Scrolling scrollables...');
      try {
        // Iterate over scrollables to scroll
        ContentScript.scrollableIndex = 0;
        const scrollable = ContentScript.scrollables[ContentScript.scrollableIndex];
        if (scrollable) {
          return resolve(await ContentScript.initScroll(scrollable));
        }
        await Common.log('Scrolled scrollables...');
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Wait for lazy images to load
   * @returns {Promise<unknown>}
   */
  static async waitForLazies() {
    return new Promise(async (resolve, reject) => {
      await Common.log('Waiting for lazy images to load...');
      const progress = 80;
      await ContentScript.postMessage({progress: progress});
      await Common.setLocalStorage({progress: progress});
      try {
        const checkImagesLoaded = setInterval(async () => {

          // Stopped
          const stopped = await ContentScript.checkStop();
          if (stopped) {
            clearInterval(checkImagesLoaded);
            return resolve(stopped);
          }

          // Finish it if there is no lazy image remained
          if (ContentScript.lazyImgs.length === 0) {
            clearInterval(checkImagesLoaded);
            await Common.log('Lazy images loaded...');
            resolve();
          } else {
            for (let i = 0; i < ContentScript.lazyImgs.length; i++) {
              let lazyImg = ContentScript.lazyImgs[i];
              const className = Object.keys(lazyImg)[0];
              lazyImg = Object.values(lazyImg)[0];

              // Check with its size if it is loaded, to remove it from the array
              if ((lazyImg.naturalWidth > 1 && lazyImg.naturalHeight > 1)) {
                ContentScript.lazyImgs = ContentScript.lazyImgs.filter(lazyImg => !lazyImg.hasOwnProperty(className));
              } else {
                // If it hasn't been loaded for the third time, ignore it
                if (ContentScript.lazyTries[className] && ContentScript.lazyTries[className] >= 3) {
                  ContentScript.lazyImgs = ContentScript.lazyImgs.filter(lazyImg => !lazyImg.hasOwnProperty(className));
                } else {
                  ContentScript.lazyTries[className] = ContentScript.lazyTries[className] ? ContentScript.lazyTries[className] + 1 : 1;
                }
              }
            }
          }
        }, 1000);
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Remove the elements that were added in the previous audit and prepare for new audit
   * @returns {Promise<void>}
   */
  static async resetElements() {
    return new Promise(async (resolve, reject) => {
      try {
        const spanXs = await Common.getElements('.oxyplug-tech-seo-highlight');
        spanXs.forEach((spanX) => {
          const img = spanX.previousElementSibling;
          if (img) {
            if (img.dataset && img.dataset.oxyplug_tech_i) {
              const i = img.dataset.oxyplug_tech_i;
              img.classList.remove(`oxyplug-tech-seo-issue-${i}`);
              delete img.dataset.oxyplug_tech_i;
            }
          }
          spanX.remove();
        });

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Disable default scroll behavior that the page might have
   * @returns {Promise<unknown>}
   */
  static async unsetDefaultScrollBehavior() {
    return new Promise(async (resolve, reject) => {
      try {
        const htmlBody = await Common.getElement('html, body');
        htmlBody.style.setProperty('scroll-behavior', 'unset', 'important');
        await Common.log('Customization of scrolling behaviour (if any) disabled...');
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Prevent <a> tags from performing any actions that may have side effects on oxyplug elements
   * @returns {Promise<void>}
   */
  static async disableATags() {
    const disableATags = await Common.getLocalStorage('disable_a_tags');
    if (disableATags) {
      return new Promise(async (resolve, reject) => {
        try {
          const as = await Common.getElements('a');
          as.forEach((a) => {
            a.href = '#';
            a.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
          });

          await Common.log('All <a>s default event prevented and propagation stopped...');
          resolve();
        } catch (error) {
          console.log(error);
          reject(error);
        }
      });
    }
  }

  /**
   * Prevent event listeners from performing any actions that may have side effects on oxyplug elements
   * @returns {Promise<void>}
   */
  static async removeEventListeners() {
    const disableMouseEvents = await Common.getLocalStorage('disable_mouse_events');
    if (disableMouseEvents) {
      return new Promise(async (resolve, reject) => {
        try {
          const elements = await Common.getElements('[onclick], [onmousedown], [onmouseup]');
          const eventListeners = ['mousedown', 'mouseup', 'click'];
          elements.forEach((element) => {
            // Remove event attributes
            eventListeners.forEach((eventListener) => {
              element.listeners = {};
              element.removeAttribute(`on${eventListener}`);
              element[`on${eventListener}`] = null;
            });

            // Clone from the element
            const clone = element.cloneNode(true);

            // Add event listener to stop it from doing anything
            eventListeners.forEach((eventListener) => {
              clone.addEventListener(eventListener, (e) => {
                e.preventDefault();
                e.stopPropagation();
              });
            });

            // Replace the element with the cloned element
            element.replaceWith(clone);
          });

          await Common.log('Mouse events (up, down, click) disabled, default event prevented and propagation stopped...');
          resolve();
        } catch (error) {
          console.log(error);
          reject(error);
        }
      });
    }
  }

  /**
   * Check if user has stopped the process
   * @returns {Promise<string|boolean>}
   */
  static async checkStop() {
    return new Promise(async (resolve, reject) => {
      try {
        if (Boolean(await Common.getLocalStorage('stopped'))) {
          await Common.log('Stopped by user!');
          return resolve('stopped');
        }

        resolve(false);
      } catch (error) {
        console.log(error)
        reject(error);
      }
    })
      .then(response => {
        return response;
      })
      .catch(error => {
        console.log(error);
        return error;
      });
  }

  /**
   * Start analyzing
   * @returns {Promise<unknown>}
   */
  static async startAnalyzing() {
    return new Promise(async (resolve, reject) => {
      try {
        // Direction
        ContentScript.rtl = Boolean(await Common.getLocalStorage('rtl_scrolling'));

        // To reset, if already audited
        const alreadyAudited = await Common.getElement('.oxyplug-tech-seo-highlight');
        if (alreadyAudited) {
          await ContentScript.resetElements();
          await Common.log('Previous elements reset...');
        } else {
          await ContentScript.unsetDefaultScrollBehavior();
          await ContentScript.disableATags();
          await ContentScript.removeEventListeners();

          // Lazy images not loaded
          const imgs = await Common.getElements('img');
          await ContentScript.markLazies(imgs);

          // Scroll the page
          let result = await ContentScript.scrollPage();

          // Mark scrollables like carousels and scroll them to load lazy images
          if (result !== 'stopped') {
            await ContentScript.markScrollables();
            result = await ContentScript.scrollScrollables();

            if (ContentScript.lazyImgs.length) {
              if (result !== 'stopped') {
                await ContentScript.waitForLazies();
              }
            }
          }
        }

        // Stopped
        const stopped = await ContentScript.checkStop();
        if (stopped) {
          await Common.setLocalStorage({is_processing: false, stopped: false, processingOn: null});
          return resolve(stopped);
        }

        // The `imgs` needed to be declared twice since `removeEventListeners` method might destroy some images
        const imgs = await Common.getElements('img');
        ContentScript.issues = await Audit.all(imgs);

        // Add all issues to storage
        let allIssues = await Common.getLocalStorage('all_issues');
        allIssues ? allIssues.push(ContentScript.issues) : allIssues = [ContentScript.issues];
        allIssues = allIssues.slice(-10);
        await Common.setLocalStorage({
          all_issues: allIssues,
          issues: ContentScript.issues,
          is_processing: false,
          processingOn: null
        });

        // Send issues to popup
        await ContentScript.postMessage({
          issues: ContentScript.issues,
          allIssues: allIssues
        });

        // Log finishing
        const log = 'Auditing finished.';
        await Common.log(log);
        resolve();
      } catch (error) {
        console.log(error);
        await Common.setLocalStorage({is_processing: false, stopped: false, processingOn: null});
        reject(error);
      }
    });
  }

  /**
   * Scroll to the point when clicked on each item in the issues list
   * @param request
   * @returns {Promise<void>}
   */
  static async scrollToPoint(request) {
    return new Promise(async (resolve, reject) => {
      try {
        // Target element
        const el = await Common.getElement(request.scrollTo);

        // Highlight the target element
        const highlights = await Common.getElements('.oxyplug-tech-seo-highlighted');
        let XColorAll = await Common.getLocalStorage('x_color_all');
        XColorAll = XColorAll ? XColorAll.toString() : '#0000ff';
        await highlights.forEach((highlight) => {
          highlight.classList.remove('oxyplug-tech-seo-highlighted');
          highlight.style.setProperty('color', XColorAll, 'important');
        });

        const nextSibling = el ? el.nextElementSibling : null;
        if (el && nextSibling) {
          nextSibling.classList.add('oxyplug-tech-seo-highlighted');
          let XColor = await Common.getLocalStorage('x_color');
          XColor = XColor ? XColor.toString() : '#ff0000';
          nextSibling.style.setProperty('color', XColor, 'important');

          // Scroll to the target element point
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
          });
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Set X color
   * @param request
   * @returns {Promise<void>}
   */
  static async setXColor(request) {
    return new Promise(async (resolve, reject) => {
      try {
        const highlights = await Common.getElements('.oxyplug-tech-seo-highlighted');
        highlights.forEach((highlight) => {
          highlight.style.color = request.newXColor;
        });

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Set all X color
   * @param request
   * @returns {Promise<void>}
   */
  static async setXColorAll(request) {
    return new Promise(async (resolve, reject) => {
      try {
        const highlights = await Common.getElements('.oxyplug-tech-seo-highlight:not(.oxyplug-tech-seo-highlighted)');
        highlights.forEach((highlight) => {
          highlight.style.color = request.newXColorAll;
        });

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }
}

ContentScript.init()
  .then(() => {
    console.log('Content Script init');
  })
  .catch(() => {
    console.log('Content Script error');
  });