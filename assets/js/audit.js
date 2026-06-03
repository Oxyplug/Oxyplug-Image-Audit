class Audit {
  static issueKey = 'oxyplug-tech-seo-issue-';
  static loadFailsList = [];
  static LCPs = [];
  static alreadyAuditeds = {};

  /**
   * Audit elements with all validations
   * @param imgs
   * @returns {Promise<unknown>}
   */
  static async all(imgs) {
    return new Promise(async (resolve, reject) => {
      await Common.log('Auditing images...');

      try {
        Audit.issues = {};
        await window.scroll({top: 0});

        // Get failed images
        Audit.loadFailsList = await Common.getLocalStorage('load_fails') ?? {};

        // LCP
        Audit.LCPs = [];
        await Audit.fillLCPs();

        let [
          loadFailsIssuesCount, srcIssuesCount, altIssuesCount,
          widthIssuesCount, heightIssuesCount, renderedSizeIssuesCount,
          aspectRatioIssuesCount, filesizeIssuesCount, nxIssuesCount,
          nextGenFormatsIssuesCount, lazyLoadIssuesCount, LCPsIssuesCount,
          preloadLCPsIssuesCount, decodingIssuesCount
        ] = Array(14).fill(0);

        let index = 1;

        // Whether to audit excluded images or not
        const exclusions = await Common.getLocalStorage('exclusions');

        // Whether to audit already audited images or not
        const dontAuditSameImages = await Common.getLocalStorage('dont_audit_same_images');
        Audit.alreadyAuditeds = {};

        for (let img of imgs) {
          // Stopped
          const stopped = await ContentScript.checkStop();
          if (stopped) return resolve(await Audit.getEmptyIssues());

          // Audit the same images again?
          let reAudit = true;
          if (dontAuditSameImages) {
            reAudit = !Audit.alreadyAuditeds[img.src];
          }

          // Not to audit excluded srcs
          let excluded = false;
          if (exclusions && exclusions[location.href]) {
            const excludedImage = exclusions[location.href];
            if (excludedImage.indexOf(img.src) !== -1) {
              excluded = true;
            }
          }

          // If the <img> is inside <picture> and has various densities/DPRs/dimensions,
          // it needs to replace the src with currentSrc in order not to load the other images that are for the other DPRs.
          // For example, when the loaded image is 300x300 with <source> but the <img> has the src of image 100x100.
          const tempNaturalWidth = img.naturalWidth;
          const tempNaturalHeight = img.naturalHeight;
          if (img.currentSrc != '' && img.src != img.currentSrc) {
            let imgLoaded = false;
            if (img.src.trim() === '') {
              img.onload = () => {
                imgLoaded = true;
              };
              img.onerror = () => {
                imgLoaded = true;
              };

              const tempCurrentSrc = img.currentSrc;

              // Remove srcset in order to have correct naturalWidth and naturalHeight in some circumstances,
              // like when there is no src attribute
              img.dataset.srcset = '';
              if (img.srcset.trim() !== '') {
                img.dataset.srcset = img.srcset;
              }
              img.srcset = '';

              img.src = tempCurrentSrc;
            } else {
              imgLoaded = true;
            }

            // Cap the wait so a cached/never-resolving image can't hang the audit.
            let waitTries = 0;
            while (imgLoaded === false && waitTries < 5) {
              await Common.wait(1000);
              waitTries++;
            }
          }

          if (img.naturalWidth > 1 && img.naturalHeight > 1) {
            img.dataset.naturalHeight = img.naturalHeight;
            img.dataset.naturalWidth = img.naturalWidth;
          } else {
            img.dataset.naturalHeight = tempNaturalHeight;
            img.dataset.naturalWidth = tempNaturalWidth;
          }

          if (
            excluded === false &&
            reAudit &&
            img.clientHeight > 1 && img.clientWidth > 1
          ) {
            img.dataset.oxyplug_tech_i = String(index++);
            if (await Audit.loadFails(img) === false) loadFailsIssuesCount++;
            if (await Audit.src(img) === false) srcIssuesCount++;
            if (await Audit.alt(img) === false) altIssuesCount++;
            if (await Audit.width(img) === false) widthIssuesCount++;
            if (await Audit.height(img) === false) heightIssuesCount++;
            // No need to scan while it is not loaded
            if (!Audit.loadFailsList[img.src]) {
              if (await Audit.renderedSize(img) === false) renderedSizeIssuesCount++;
              if (await Audit.aspectRatio(img) === false) aspectRatioIssuesCount++;
              if (await Audit.filesize(img) === false) filesizeIssuesCount++;
            }
            if (await Audit.nx(img) === false) nxIssuesCount++;
            if (await Audit.nextGenFormats(img) === false) nextGenFormatsIssuesCount++;
            if (await Audit.lazyLoad(img) === false) lazyLoadIssuesCount++;
            if (await Audit.preloadLCP(img) === false) preloadLCPsIssuesCount++;
            if (await Audit.LCP(img) === false) LCPsIssuesCount++;
            if (await Audit.decoding(img) === false) decodingIssuesCount++;
          }

          Audit.alreadyAuditeds[img.src] = true;
        }
        await Common.log('All images audited...');

        /**
         * By changing 1st image wrap, it would change the width and height of 2nd image wrap,
         * so what it got from 2nd image wrap was a wrong width/height.
         *
         * So the width/height stored in dataset in order not to destroy the other elements and
         * are being applied to the image wrap here.
         */
        await Audit.setImageSize();

        // Check if the X is not overlaid by other elements and is clickable
        await Audit.hideOverlays();

        resolve({
          audit: {date: await Audit.getFormattedDate(), page: location.href},
          issues: Audit.issues,
          count: {
            'load-fails-issue': loadFailsIssuesCount,
            'src-issue': srcIssuesCount,
            'alt-issue': altIssuesCount,
            'width-issue': widthIssuesCount,
            'height-issue': heightIssuesCount,
            'rendered-size-issue': renderedSizeIssuesCount,
            'aspect-ratio-issue': aspectRatioIssuesCount,
            'filesize-issue': filesizeIssuesCount,
            'nx-issue': nxIssuesCount,
            'next-gen-formats-issue': nextGenFormatsIssuesCount,
            'lazy-load-issue': lazyLoadIssuesCount,
            'preload-lcp-issue': preloadLCPsIssuesCount,
            'lcp-issue': LCPsIssuesCount,
            'decoding-issue': decodingIssuesCount,
          }
        });
      } catch (error) {
        console.log(error);
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

  // Validations Start
  /**
   * Audit images fails to load
   * @returns {Promise<boolean>}
   */
  static async loadFails(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'loadFailsIssue';

        if (img) {
          let message = '';

          if (Audit.loadFailsList[img.src]) {
            const httpStatusCode = Audit.loadFailsList[img.src];
            message = 'The image fails to load with http status code of ' + httpStatusCode + '.';
          }

          if (await Audit.hasSpace(img)) {
            message = 'The paths in srcset must not have any space.';
          }

          if (message !== '') {
            return resolve(await Audit.addToIssues(message, issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit src
   * @returns {Promise<boolean>}
   */
  static async src(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'srcIssue';
        if (!img.hasAttribute('src')) {
          return resolve(await Audit.addToIssues('Without src attribute.', issueType, img));
        } else if (img.getAttribute('src') === '') {
          return resolve(await Audit.addToIssues('The src attribute is empty.', issueType, img));
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit alt
   * @returns {Promise<boolean>}
   */
  static async alt(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'altIssue';
        if (!img.hasAttribute('alt')) {
          return resolve(await Audit.addToIssues('Without alt attribute.', issueType, img));
        } else {
          const imgAlt = img.getAttribute('alt').trim();
          const imgAltLength = imgAlt.length;
          const maxImageAlt = await Common.getLocalStorage('max_image_alt'); // Length in characters
          if (imgAltLength === 0) {
            return resolve(await Audit.addToIssues('The alt attribute is empty.', issueType, img));
          } else if (imgAltLength > maxImageAlt) {
            return resolve(await Audit.addToIssues('The alt attribute length is more than ' + maxImageAlt + ' characters.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit width
   * @returns {Promise<boolean>}
   */
  static async width(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'widthIssue';
        let hasHeightAndAspectRatio = false;
        if (img.hasAttribute('height') && img.getAttribute('height').trim() != '') {
          const imgComputedStyle = getComputedStyle(img);
          if (imgComputedStyle.aspectRatio !== 'auto') {
            hasHeightAndAspectRatio = true;
          }
        }

        if (hasHeightAndAspectRatio === false) {
          if (!img.hasAttribute('width')) {
            return resolve(await Audit.addToIssues('Without width attribute.', issueType, img));
          } else if (img.getAttribute('width').trim() === '') {
            return resolve(await Audit.addToIssues('The width attribute is empty.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit height
   * @returns {Promise<boolean>}
   */
  static async height(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'heightIssue';

        let hasWidthAndAspectRatio = false;
        if (img.hasAttribute('width') && img.getAttribute('width').trim() != '') {
          const imgComputedStyle = getComputedStyle(img);
          if (imgComputedStyle.aspectRatio !== 'auto') {
            hasWidthAndAspectRatio = true;
          }
        }

        if (hasWidthAndAspectRatio === false) {
          if (!img.hasAttribute('height')) {
            return resolve(await Audit.addToIssues('Without height attribute.', issueType, img));
          } else if (img.getAttribute('height').trim() === '') {
            return resolve(await Audit.addToIssues('The height attribute is empty.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit rendered size
   * @returns {Promise<boolean>}
   */
  static async renderedSize(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const imgNaturalWidth = img.dataset.naturalWidth;
        const imgNaturalHeight = img.dataset.naturalHeight;

        const issueType = 'renderedSizeIssue';
        const tolerance = 1;
        const addedTolerance = {
          imgWidthMinus: img.width - tolerance,
          imgWidthPlus: img.width + tolerance,
          imgHeightMinus: img.height - tolerance,
          imgHeightPlus: img.height + tolerance,
        };

        if (
          imgNaturalWidth < addedTolerance.imgWidthMinus ||
          imgNaturalWidth > addedTolerance.imgWidthPlus ||
          imgNaturalHeight < addedTolerance.imgHeightMinus ||
          imgNaturalHeight > addedTolerance.imgHeightPlus
        ) {

          let message = 'The rendered image dimensions don\'t equal the original image dimensions. ';
          message += 'Rendered Dimensions: ' + img.width + 'x' + img.height;
          message += ' | Original Dimensions: ' + imgNaturalWidth + 'x' + imgNaturalHeight;

          return resolve(await Audit.addToIssues(message, issueType, img));
        }

        return resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit aspect ratio
   * @returns {Promise<boolean>}
   */
  static async aspectRatio(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'aspectRatioIssue';
        const tolerance = 1;
        if (Math.abs((img.dataset.naturalWidth / img.dataset.naturalHeight) - (img.width / img.height)) > tolerance) {
          return resolve(await Audit.addToIssues('The aspect-ratio of the rendered image doesn\'t equal the aspect-ratio of the original image.', issueType, img));
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Audit filesize
   * @returns {Promise<boolean>}
   */
  static async filesize(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'filesizeIssue';
        if (img) {
          const maxImageFilesize = await Common.getLocalStorage('max_image_filesize'); // KB
          const imageFilesizes = await Common.getLocalStorage('image_filesizes');
          if (imageFilesizes && imageFilesizes[img.src] && imageFilesizes[img.src] > maxImageFilesize) {
            return resolve(await Audit.addToIssues('The image filesize is bigger than ' + maxImageFilesize + ' KB.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Whether the image has image-2x
   * @param img
   * @returns {Promise<boolean>}
   */
  static async nx(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'nxIssue';
        if (img) {
          if (img.src.toLowerCase().endsWith('.svg')) {
            return resolve(true);
          }

          let has2x = false;
          let srcsets = null;

          // <picture srcset="...">
          const sources = await Audit.getPictureSources(img);
          if (sources.length) {
            srcsets = sources[0].getAttribute('srcset');
          }

          // <img srcset="...">
          if (srcsets == null) {
            srcsets = img.dataset.srcset;
          }

          if (srcsets) {
            srcsets = srcsets.split(',').map(srcset => srcset.trim());
            has2x = srcsets.some(srcset => srcset.endsWith('2x'));
          }

          if (!has2x) {
            return resolve(await Audit.addToIssues('No 2x image found for DPR 2 devices.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * Whether the image has next generation formats
   * @param img
   * @returns {Promise<boolean>}
   */
  static async nextGenFormats(img) {
    return new Promise(async (resolve, reject) => {
      try {
        if (img.src.toLowerCase().endsWith('.svg')) {
          return resolve(true);
        }

        const issueType = 'nextGenFormatsIssue';
        let parentElement = img.parentElement;
        for (let p = 1; p <= 3; p++) {
          if (parentElement) {
            if (parentElement.tagName.toLowerCase() === 'picture') {
              const nextGens = parentElement.querySelector('source[type="image/webp"], source[type="image/avif"]');
              if (nextGens) {
                return resolve(true);
              }
            }

            parentElement = parentElement.parentElement;
          } else {
            break;
          }
        }

        const extension = img.src.split('.').pop().toLowerCase();
        if (['webp', 'avif'].includes(extension) || extension.length > 4) {
          return resolve(true);
        }

        resolve(await Audit.addToIssues('The next-gen (WebP, AVIF) is not provided.', issueType, img));
      } catch (error) {
        console.log(error);
        reject(true);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * If the element has loading="lazy"
   * @param img
   * @returns {Promise<boolean>}
   */
  static async lazyLoad(img) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueType = 'lazyLoadIssue';
        const isOffscreen = await Audit.isOffscreen(img);

        // LCP image must be loaded eagerly. `loading="eager"`
        if (Audit.LCPs.includes(img)) {
          if (img.getAttribute('loading') === 'lazy' || img.dataset.hasLoading === 'lazy') {
            return resolve(await Audit.addToIssues('The LCP image must be loaded eagerly. `loading="eager"`', issueType, img));
          }
        }
        // Below-the-fold images must be loaded lazily. `loading="lazy"`
        else if (isOffscreen) {
          let isLazy = true;
          if (img.dataset.hasLoading && img.dataset.hasLoading !== 'lazy')
            isLazy = false;
          else if (img.hasAttribute('loading') && img.getAttribute('loading') !== 'lazy')
            isLazy = false;

          if (isLazy === false) {
            return resolve(await Audit.addToIssues('The loading attribute doesn\'t equal `lazy`.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Get <source>s in <picture>
   * @param img
   * @returns {Promise<[]>}
   */
  static async getPictureSources(img) {
    return new Promise(resolve => {
      let sources = [];
      if (img) {
        let pictureElement = null;
        let parentElement = img.parentElement;
        for (let p = 1; p <= 3; p++) {
          if (parentElement) {
            if (parentElement.tagName.toLowerCase() === 'picture') {
              pictureElement = parentElement;
              break;
            }

            parentElement = parentElement.parentElement;
          } else {
            break;
          }
        }

        if (pictureElement) {
          sources = pictureElement.querySelectorAll('source');
        }
      }

      resolve(sources);
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
   * The paths in srcset must not have any space
   * @param img
   * @returns {Promise<unknown>}
   */
  static async hasSpace(img) {
    return new Promise(async (resolve, reject) => {
      try {
        if (img.src.toLowerCase().endsWith('.svg')) {
          return resolve(false);
        }

        const hasMultipleSpace = async (el) => {
          return new Promise(resolve => {
            let srcset = '';
            if (el.dataset.srcset.trim()) {
              srcset = el.dataset.srcset;
            }

            if (!srcset) {
              if (el.hasAttribute('srcset')) {
                srcset = el.getAttribute('srcset');
              }
            }

            if (srcset) {
              const srcsetSplit = srcset.split(',');
              for (const srcset of srcsetSplit) {
                if (/(.*\s){2,}/.test(srcset.trim())) {
                  return resolve(true);
                }
              }
            }

            resolve(false);
          })
            .then(response => {
              return response;
            })
            .catch(_ => {
              return false;
            });
        };

        // <picture srcset="...">
        const sources = await Audit.getPictureSources(img);
        if (sources.length) {
          for (const source of sources) {
            if (await hasMultipleSpace(source)) {
              return resolve(true);
            }
          }
        }

        // <img srcset="...">
        if (await hasMultipleSpace(img)) {
          return resolve(true);
        }

        resolve(false);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Check if the LCP image is preloaded
   * @param img
   * @returns {Promise<boolean>}
   */
  static async preloadLCP(img) {
    return new Promise(async (resolve, reject) => {
      try {
        if (Audit.LCPs.length) {
          if (Audit.LCPs.includes(img)) {

            // check img tag src in href of link tag
            const imageLink = 'head > link[rel="preload"][as="image"]';
            const hasPreload = await Common.getElement(`${imageLink}[href="${img.src}"]`);
            if (hasPreload) {
              return resolve(true);
            }

            // check img tag src in imagesrcset of link tag
            const preloads = await Common.getElements(imageLink);
            for (const preload of preloads) {
              if (preload.hasAttribute('imagesrcset')) {
                const imagesrcsetSplit = preload.getAttribute('imagesrcset').split(',');
                for (let imagesrcset of imagesrcsetSplit) {
                  imagesrcset = imagesrcset.trim().split(' ')[0];
                  if (imagesrcset == img.src) {
                    return resolve(true);
                  }
                }
              }
            }

            const issueType = 'preloadLcpIssue';
            return resolve(await Audit.addToIssues('The LCP (Image) is not preloaded with link tag.', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Display the LCP image above the fold
   * @param img
   * @returns {Promise<boolean>}
   */
  static async LCP(img) {
    return new Promise(async (resolve, reject) => {
      try {
        if (Audit.LCPs.length) {
          if (Audit.LCPs.includes(img)) {
            const issueType = 'lcpIssue';
            return resolve(await Audit.addToIssues('LCP (Image)', issueType, img));
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Check the LCP image to have decoding="sync"
   * @param img
   * @returns {Promise<boolean>}
   */
  static async decoding(img) {
    return new Promise(async (resolve, reject) => {
      try {
        if (Audit.LCPs.length) {
          if (Audit.LCPs.includes(img)) {
            const issueType = 'decodingIssue';
            if (img.getAttribute('decoding') !== 'sync') {
              return resolve(await Audit.addToIssues('Having `decoding="sync"` for LCP image is recommended.', issueType, img));
            }
          }
        }

        resolve(true);
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  // Validations End

  /**
   * Prevents click events from propagating through the DOM tree
   * @param els
   * @returns {Promise<void>}
   */
  static async preventPropagation(els) {
    return new Promise((resolve, reject) => {
      try {
        const events = ['mousedown', 'mouseup', 'click'];
        els.forEach((el) => {
          events.forEach((event) => {
            el.addEventListener(event, (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
          });
        });

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Deactivate anchor tags and prevent default click behavior
   * @param spanX
   * @returns {Promise<void>}
   */
  static async disableATags(spanX) {
    const disableATags = await Common.getLocalStorage('disable_a_tags');
    if (disableATags) {
      return new Promise((resolve, reject) => {
        try {
          let isAffectedByAnchorTag = false;
          let closestAnchorTag = null;
          let currentElement = spanX.parentElement;
          while (currentElement && !isAffectedByAnchorTag) {
            if (currentElement.tagName === 'A') {
              isAffectedByAnchorTag = true;
              closestAnchorTag = currentElement;
            }

            currentElement = currentElement.parentElement;
          }

          if (closestAnchorTag) {
            closestAnchorTag.href = '#';
            closestAnchorTag.addEventListener('click', (e) => {
              e.preventDefault();
            });
          }

          resolve();
        } catch (error) {
          console.log(error);
          reject(error);
        }
      });
    }
  }

  /**
   * Add issues to an object
   * @param message
   * @param issueType
   * @param img
   * @returns {Promise<boolean>}
   */
  static async addToIssues(message, issueType, img) {
    return new Promise(async (resolve, reject) => {
      try {
        const imgComputedStyle = getComputedStyle(img);

        const i = img.dataset.oxyplug_tech_i;
        const issueKey = Audit.issueKey + i;
        const className = '.' + issueKey;
        if (Audit.issues[className]) {
          Audit.issues[className].messages.push(message);
          Audit.issues[className].issueTypes.push(issueType);
        } else {
          if (![...img.classList].includes(issueKey)) {
            img.classList.add(issueKey);
            let imgHeight = parseFloat(imgComputedStyle.height);
            if (imgHeight == 0) {
              imgHeight = img.clientHeight;
              if (imgHeight == 0 && img.parentElement) {
                imgHeight = img.parentElement.clientHeight;
              }
            }

            let imgWidth = parseFloat(imgComputedStyle.width);
            if (imgWidth == 0) {
              imgWidth = img.clientWidth;
              if (imgWidth == 0 && img.parentElement) {
                imgWidth = img.parentElement.clientWidth;
              }
            }

            // spanX
            const spanX = document.createElement('span');
            spanX.innerText = 'X';
            spanX.classList.add('oxyplug-tech-seo-highlight');

            let XColor = await Common.getLocalStorage('x_color');
            XColor = XColor ? XColor.toString() : '#ff0000';
            let XColorAll = await Common.getLocalStorage('x_color_all');
            XColorAll = XColorAll ? XColorAll.toString() : '#0000ff';
            spanX.style.setProperty('color', XColorAll, 'important');

            // Show issues
            spanX.addEventListener('click', async (e) => {
              e.preventDefault();

              // Highlight the target element
              const highlights = await Common.getElements('.oxyplug-tech-seo-highlighted');
              await highlights.forEach((highlight) => {
                highlight.classList.remove('oxyplug-tech-seo-highlighted');
                highlight.style.setProperty('color', XColorAll, 'important');
              });
              spanX.classList.add('oxyplug-tech-seo-highlighted');
              spanX.style.setProperty('color', XColor, 'important');

              const messages = Audit.issues[className] ? Audit.issues[className].messages : [];
              const issueTypes = Audit.issues[className] ? Audit.issues[className].issueTypes : [];
              await Common.showIssues(messages, issueTypes);
            });

            // Put spanX after img
            img.after(spanX);

            // Prevent default actions including opening links in a new tab
            await Audit.preventPropagation([img, spanX]);

            // Deactivate parent possible anchor tags
            await Audit.disableATags(spanX);

            // Set size of X equivalent to image size
            const spanComputedStyle = getComputedStyle(spanX);
            const spanFontSize = spanComputedStyle.fontSize;
            const fontSize = spanFontSize.replace(/px$/, '');
            const imgBigger = Math.min(parseInt(imgWidth), parseInt(imgHeight));
            if (fontSize > imgBigger) {
              spanX.style.fontSize = imgBigger + 'px';
            }
          }

          const url = (img.src && img.src.trim().length > 0) ? img.src : 'Without src attribute';
          Audit.issues[className] = {
            messages: [message],
            url: url,
            issueTypes: [issueType],
          };
        }

        resolve(false);
      } catch (error) {
        console.log(error);
        reject(true);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  };

  /**
   * If the element is out of the viewport
   * @param img
   * @returns {Promise<boolean>}
   */
  static async isOffscreen(img) {
    return new Promise((resolve, reject) => {
      try {
        const rect = img.getBoundingClientRect();
        resolve(
          (rect.x + rect.width) < 0 ||
          (rect.y + rect.height) < 0 ||
          (rect.x > window.innerWidth) ||
          (rect.y > window.innerHeight)
        );
      } catch (error) {
        console.log(error);
        reject(false);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Fill the LCPs above the fold to be used in LCP method
   * @returns {Promise<void>}
   */
  static async fillLCPs() {
    return new Promise(async (resolve, reject) => {
      try {
        let lcpElement = null;
        let lastWidth = 0;
        let lastHeight = 0;
        let possibleLCPs = [];

        const elements = await Common.getElements('img');
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          if (element.getBoundingClientRect().top >= window.innerHeight) {
            continue;
          }

          if (element.offsetWidth > lastWidth && element.offsetHeight > lastHeight) {
            lastWidth = element.offsetWidth;
            lastHeight = element.offsetHeight;
            lcpElement = element;
          } else if (lcpElement && element.currentSrc === lcpElement.currentSrc) {
            possibleLCPs.push(element);
          }
        }

        if (possibleLCPs.length) {
          const possibleLCP = await Audit.getVisibleLCP(possibleLCPs);
          if (possibleLCP) {
            lcpElement = possibleLCP;
          }
        }

        if (lcpElement) {
          Audit.LCPs.push(lcpElement);
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Check visibility of the LCP elements
   * @param possibleLCPs
   * @returns {Promise<void>}
   */
  static async getVisibleLCP(possibleLCPs) {
    return new Promise(async (resolve, reject) => {
      try {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            const target = entry.target;

            // Check if it is visible
            if (entry.isIntersecting) {
              resolve(target);
            }
            observer.unobserve(target);
          });
        });

        for (const possibleLCP of possibleLCPs) {
          possibleLCP.scrollIntoView({
            block: 'center',
            inline: 'center'
          });

          await Common.wait(500);

          observer.observe(possibleLCP);
        }

        await Common.wait(1000);
        resolve(null);
      } catch (error) {
        console.log(error);
        reject(null);
      }
    })
      .then(response => {
        return response;
      })
      .catch(response => {
        return response;
      });
  }

  /**
   * Get width/height from its dataset and apply to it in its css
   * @returns {Promise<void>}
   */
  static async setImageSize() {
    return new Promise(async (resolve, reject) => {
      await Common.log('Positioning and styling...');
      try {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            const img = entry.target;
            const spanX = img.nextElementSibling;

            // Check if it is visible
            if (entry.isIntersecting) {
              if (spanX && img) {
                applyStyles(spanX, img);
                observer.unobserve(img);
              }
            }
          });
        });

        const applyStyles = (spanX, img) => {
          spanX.style.width = img.clientWidth + 'px';
          spanX.style.height = spanX.style.lineHeight = img.clientHeight + 'px';
          spanX.style.left = img.offsetLeft + 'px';
          spanX.style.top = img.offsetTop + 'px';

          const styles = window.getComputedStyle(img);
          const defaultStyles = window.getComputedStyle(document.querySelector('html'));
          for (let i = 0; i < styles.length; i++) {
            const styleName = styles[i];
            const value = styles.getPropertyValue(styleName);
            let applyIt = false;
            if (['width', 'height', 'transform'].includes(styleName)) {
              applyIt = true;
            } else if (['right', 'bottom'].includes(styleName)) {
              if (parseFloat(value) > 0) {
                applyIt = true;
              }
            }

            if (applyIt) {
              const isDefault = value === defaultStyles.getPropertyValue(styleName);
              if (!isDefault) {
                spanX.style[styleName] = value;
              }
            }
          }
          spanX.style.lineHeight = img.clientHeight + 'px';
        }

        const spanXs = await Common.getElements('.oxyplug-tech-seo-highlight:not(.positioned)');
        for (const spanX of spanXs) {
          spanX.classList.add('positioned');
          const img = spanX.previousElementSibling;
          if (spanX && img) {
            applyStyles(spanX, img);
            observer.observe(img);
          }
        }

        await Common.log('Positioned and styled...');
        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Hide whatever possible elements on the X and its vicinity
   * @returns {Promise<void>}
   */
  static async hideOverlays() {
    const hideXOverlays = await Common.getLocalStorage('hide_x_overlays');
    if (hideXOverlays) {
      return new Promise(async (resolve, reject) => {
        try {
          const Xs = await Common.getElements('.oxyplug-tech-seo-highlight');
          for (const X of Xs) {
            const computedStyle = window.getComputedStyle(X);
            const isVisible = !!X.offsetWidth && !!X.offsetHeight && !!X.offsetParent &&
              computedStyle.getPropertyValue('display') !== 'none' &&
              computedStyle.getPropertyValue('visibility') !== 'hidden';

            if (isVisible) {
              let rect = X.getBoundingClientRect();
              let elem2check = document.elementFromPoint(rect.x, rect.y);
              if (!elem2check) {
                await new Promise(async (resolve) => {
                  await window.scrollTo(window.scrollX + rect.left, window.scrollY + rect.top);
                  resolve();
                });
                rect = X.getBoundingClientRect();
                elem2check = document.elementFromPoint(rect.x, rect.y);
              }

              if (elem2check) {
                let overlaid = true;

                // Exclude Oxyplug's elements
                ['oxyplug-tech-seo-highlight', 'oxyplug-tech-seo-issue'].forEach((className) => {
                  if (elem2check.className && elem2check.className.indexOf(className) > -1) {
                    overlaid = false;
                  }
                });

                // Exclude specific tags
                ['HTML', 'BODY'].forEach((tagName) => {
                  if (elem2check.tagName == tagName) {
                    overlaid = false;
                  }
                });

                if (overlaid) {
                  elem2check.style.display = 'none';
                }
              }
            }
          }
          await window.scroll({top: 0});
          await Common.log('Overlays on the images got hidden...');

          resolve();
        } catch (error) {
          console.log(error);
          reject(error);
        }
      })
    }
  }

  /**
   * Get formatted date
   * @param date
   * @returns {Promise<string>}
   */
  static async getFormattedDate(date = new Date()) {
    return new Promise((resolve) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');

      resolve(`${year}/${month}/${day} ${hours}:${minutes}:${seconds}`);
    })
      .then(response => {
        return response;
      })
      .catch(error => {
        console.log(error)
        return 'N/A';
      });
  }

  /**
   * Get empty issues
   * @returns {Promise<{audit: {date: string, page: string}, count: {"next-gen-formats-issue": number, "nx-issue": number, "src-issue": number, "decoding-issue": number, "load-fails-issue": number, "filesize-issue": number, "lazy-load-issue": number, "height-issue": number, "lcp-issue": number, "alt-issue": number, "width-issue": number, "all-issue": number, "rendered-size-issue": number, "aspect-ratio-issue": number, "preload-lcp-issue": number}, issues: {}}>}
   */
  static async getEmptyIssues() {
    return {
      audit: {date: await Audit.getFormattedDate(), page: location.href},
      issues: {},
      count: {
        'load-fails-issue': 0,
        'src-issue': 0,
        'alt-issue': 0,
        'width-issue': 0,
        'height-issue': 0,
        'rendered-size-issue': 0,
        'aspect-ratio-issue': 0,
        'filesize-issue': 0,
        'nx-issue': 0,
        'next-gen-formats-issue': 0,
        'lazy-load-issue': 0,
        'preload-lcp-issue': 0,
        'lcp-issue': 0,
        'decoding-issue': 0,
        'all-issue': 0,
      }
    }
  }
}