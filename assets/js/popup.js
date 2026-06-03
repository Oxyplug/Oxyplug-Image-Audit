class Popup {
  static issues = {};
  static start;
  static stop;

  // Default
  static maxImageFilesizeDefault = 150;
  static maxImageAltDefault = 150;
  static maxScrollingDefault = 15000;

  // Max
  static maxImageFilesizeMax = 2000;
  static maxImageAltMax = 256;
  static maxScrollingMax = 15000;

  /**
   * Init
   * @returns {Promise<void>}
   */
  static async init() {
    return new Promise(async (resolve, reject) => {
      try {
        // Get current tab
        const currentTab = await Common.getCurrentTab();
        const currentHost = await Popup.getCurrentHost(currentTab);
        const currentHref = await Popup.getCurrentHref(currentTab);
        const processingOn = await Common.getLocalStorage('processingOn');

        // Prevent opening popup while it is processing on another tab
        if (
          processingOn &&
          currentHref &&
          (processingOn.href !== currentHref || processingOn.tabId !== currentTab.id)
        ) {
          window.close();
          const confirmed = confirm('Currently processing on another tab. Please wait for it to finish or cancel the operation. Would you prefer switching to that tab?');
          if (confirmed) {
            await chrome.tabs.update(processingOn.tabId, {active: true});
          }
          return resolve();
        }

        // Show body
        document.body.classList.remove('d-none');

        // Prevent displaying popup on blank pages
        if (!currentTab.title) {
          window.close();
          alert('Looks like the current page is a blank page. Please navigate to a valid webpage to use the extension.');
          return resolve();
        }

        Popup.currentTab = currentTab;
        Popup.currentHost = currentHost;
        Popup.currentHref = currentHref;

        // Reset the exclusion notification that has already been run
        await Common.setLocalStorage({exclusion_already_alerted: false});

        // Buttons
        Popup.start = await Common.getElement('#start');
        Popup.stop = await Common.getElement('#stop');
        Popup.purgeReload = await Common.getElement('#purge-reload');

        // Is it processing?
        const isProcessing = Boolean(await Common.getLocalStorage('is_processing'));
        if (isProcessing) {
          await Popup.processingState(true);
          const checkProcessing = setInterval(async () => {
            const isProcessing = Boolean(await Common.getLocalStorage('is_processing'));
            if (!isProcessing) {
              clearInterval(checkProcessing);
              await Popup.initData();
            }
          }, 3000);
        } else {
          await Popup.initData();
        }

        // Set progress percentage
        const percent = await Common.getLocalStorage('progress');
        await Popup.progress(percent);

        // Load and show issues history logs
        await Popup.loadIssuesHistoryList();

        // Max image filesize
        let maxImageFilesize = Number(await Common.getLocalStorage('max_image_filesize'));
        maxImageFilesize = isNaN(maxImageFilesize) ? Popup.maxImageFilesizeDefault : Math.abs(maxImageFilesize);
        const maxImageFilesizeEl = await Common.getElement('#oxyplug-max-image-filesize');
        await Common.setLocalStorage({max_image_filesize: maxImageFilesize});
        maxImageFilesizeEl.max = Popup.maxImageFilesizeMax;
        maxImageFilesizeEl.value = maxImageFilesize;
        maxImageFilesizeEl.addEventListener('input', (el) => {
          let value = Number(el.target.value);
          value = isNaN(value) || value < 1 ? 1 : value;
          Common.setLocalStorage({max_image_filesize: value});
        });

        // Max image alt
        let maxImageAlt = Number(await Common.getLocalStorage('max_image_alt'));
        maxImageAlt = isNaN(maxImageAlt) ? Popup.maxImageAltDefault : Math.abs(maxImageAlt);
        const maxImageAltEl = await Common.getElement('#oxyplug-max-image-alt');
        await Common.setLocalStorage({max_image_alt: maxImageAlt});
        maxImageAltEl.max = Popup.maxImageAltMax;
        maxImageAltEl.value = maxImageAlt;
        maxImageAltEl.addEventListener('input', (el) => {
          let value = Number(el.target.value);
          value = isNaN(value) || value < 1 ? 1 : value;
          Common.setLocalStorage({max_image_alt: value});
        });

        // Max scrolling
        let maxScrolling = Number(await Common.getLocalStorage('max_scrolling'));
        maxScrolling = isNaN(maxScrolling) ? Popup.maxScrollingDefault : Math.abs(maxScrolling);
        const maxScrollingEl = await Common.getElement('#oxyplug-max-scrolling');
        await Common.setLocalStorage({max_scrolling: maxScrolling});
        maxScrollingEl.max = Popup.maxScrollingMax;
        maxScrollingEl.value = maxScrolling;
        maxScrollingEl.addEventListener('input', (el) => {
          let value = Number(el.target.value);
          const invalidValue = isNaN(value) || value < 1 || value > Popup.maxScrollingMax;
          value = invalidValue ? Popup.maxScrollingDefault : value;
          Common.setLocalStorage({max_scrolling: value});
        });

        // Check if the max scrolling value is 0 which means unlimited in order to disable/enable number input
        if (maxScrolling == 0) {
          const unlimitedMaxScrollingEl = await Common.getElement('#unlimited-max-scrolling');
          unlimitedMaxScrollingEl.checked = true;
          maxScrollingEl.disabled = true;
        } else {
          const limitedMaxScrollingEl = await Common.getElement('#limited-max-scrolling');
          limitedMaxScrollingEl.checked = true;
          maxScrollingEl.disabled = false;
        }

        // Disable/Enable number input depending on the radio value
        const maxScrollingRadioEls = await Common.getElements('[name="max_scrolling"]');
        maxScrollingRadioEls.forEach((maxScrollingRadioEl) => {
          maxScrollingRadioEl.addEventListener('change', async (el) => {
            if (el.target.value == 'u') {
              await Common.setLocalStorage({
                max_scrolling: 0,
                max_scrolling_backup: maxScrollingEl.value
              });
              maxScrollingEl.value = 0;
              maxScrollingEl.disabled = true;
            } else {
              let maxScrollingBackup = Number(await Common.getLocalStorage('max_scrolling_backup'));
              const invalidValue = isNaN(maxScrollingBackup) || maxScrollingBackup < 1 || maxScrollingBackup > Popup.maxScrollingMax;
              maxScrollingBackup = invalidValue ? Popup.maxScrollingDefault : maxScrollingBackup;
              await Common.setLocalStorage({max_scrolling: maxScrollingBackup});
              maxScrollingEl.value = maxScrollingBackup;
              maxScrollingEl.disabled = false;
            }
          })
        });

        // X Color
        const xColor = await Common.getLocalStorage('x_color');
        const XColorEl = await Common.getElement('#oxyplug-x-color');
        XColorEl.value = xColor ?? '#ff0000';
        XColorEl.addEventListener('change', (el) => {
          const isColor = /^#[\dA-F]{6}$/i.test(el.target.value);
          const xColor = isColor ? el.target.value : '#ff0000';
          Common.setLocalStorage({x_color: xColor});
          Popup.postMessage({newXColor: xColor});
        });

        // X Color All
        const xColorAll = await Common.getLocalStorage('x_color_all');
        const XColorAllEl = await Common.getElement('#oxyplug-x-color-all');
        XColorAllEl.value = xColorAll ?? '#0000ff';
        XColorAllEl.addEventListener('change', (el) => {
          const isColor = /^#[\dA-F]{6}$/i.test(el.target.value);
          const xColorAll = isColor ? el.target.value : '#0000ff';
          Common.setLocalStorage({x_color_all: xColorAll});
          Popup.postMessage({newXColorAll: xColorAll});
        });

        // RTL
        const rtlScrolling = await Common.getLocalStorage('rtl_scrolling');
        const rtlScrollingEl = await Common.getElement('#oxyplug-rtl-scrolling');
        rtlScrollingEl.checked = rtlScrolling ?? false;
        rtlScrollingEl.addEventListener('change', (el) => {
          Common.setLocalStorage({rtl_scrolling: el.target.checked});
        });

        // Disable <a> tags
        const disableATags = await Common.getLocalStorage('disable_a_tags');
        const disableATagsEl = await Common.getElement('#oxyplug-disable-a-tags');
        disableATagsEl.checked = disableATags ?? false;
        disableATagsEl.addEventListener('change', (el) => {
          Common.setLocalStorage({disable_a_tags: el.target.checked});
        });

        // Disable mouse events (up, down, click)
        const disableMouseEvents = await Common.getLocalStorage('disable_mouse_events');
        const disableMouseEventsEl = await Common.getElement('#oxyplug-disable-mouse-events');
        disableMouseEventsEl.checked = disableMouseEvents ?? false;
        disableMouseEventsEl.addEventListener('change', (el) => {
          Common.setLocalStorage({disable_mouse_events: el.target.checked});
        });

        // Hide overlays on Oxyplug's X in order to be clickable
        const hideXOverlays = await Common.getLocalStorage('hide_x_overlays');
        const hideXOverlaysEl = await Common.getElement('#oxyplug-hide-x-overlays');
        hideXOverlaysEl.checked = hideXOverlays ?? false;
        hideXOverlaysEl.addEventListener('change', (el) => {
          Common.setLocalStorage({hide_x_overlays: el.target.checked});
        });

        // Do not audit the same images
        const dontAuditSameImages = await Common.getLocalStorage('dont_audit_same_images');
        const dontAuditSameImagesEl = await Common.getElement('#oxyplug-dont-audit-same-images');
        dontAuditSameImagesEl.checked = dontAuditSameImages ?? false;
        dontAuditSameImagesEl.addEventListener('change', (el) => {
          Common.setLocalStorage({dont_audit_same_images: el.target.checked});
        });

        // Get exclusions for exclusions tab
        const exclusions = await Common.getLocalStorage('exclusions');
        if (exclusions && exclusions[Popup.currentHref] && exclusions[Popup.currentHref].length) {
          const exclusionsEl = await Common.getElement('#exclusions');
          const exclusionsUl = await exclusionsEl.querySelector(':scope > ul');
          const noExclusionsEl = await exclusionsEl.querySelector('p');

          // Remove `No exclusions`
          if (noExclusionsEl) {
            noExclusionsEl.remove();
          }

          // No exclusions element
          const p = document.createElement('p');
          p.innerText = 'No exclusions.';

          // Create the exclusions list
          for (const exclusion of exclusions[Popup.currentHref]) {
            const exclusionLi = document.createElement('li');
            exclusionLi.innerText = decodeURI(exclusion);

            // Remove
            const button = document.createElement('button');
            button.classList.add('oxyplug-icon-bin');
            button.onclick = async () => {
              const index = exclusions[Popup.currentHref].indexOf(exclusion);
              if (index !== -1) {
                exclusions[Popup.currentHref].splice(index, 1);
                await Common.setLocalStorage({exclusions});
                exclusionLi.remove();
              }

              // No exclusions.
              if (!await exclusionsUl.querySelector('li')) {
                exclusionsEl.append(p);
              }
            };

            // Make complete src to be able to show in new tab
            await Popup.openInNewTab(exclusionsUl, exclusionLi, exclusion, button);
          }
        }

        // Start Analyzing
        Popup.start.addEventListener('click', async () => {
          try {
            await Common.setLocalStorage({
              logsBoxIsHidden: false,
              processingOn: {
                href: Popup.currentHref,
                tabId: Popup.currentTab.id
              }
            });
            await Popup.clearLogs();
            await Popup.progress(0);
            await Popup.showLogs();
            await Popup.resetList();
            await Common.setLocalStorage({is_processing: true, stopped: false});
            await Popup.processingState(true);
            await Popup.postMessage({start: true});
          } catch (error) {
            console.log(error)
          }
        });

        // Stop Analyzing
        Popup.stop.addEventListener('click', async () => {
          await Common.setLocalStorage({is_processing: false, stopped: true, processingOn: null});
          await Popup.processingState(false);
        });

        // Clear Xs by reloading the page
        Popup.purgeReload.addEventListener('click', async () => {
          Popup.purgeReload.disabled = true;
          await Popup.hideLogs();
          await Popup.renameStart('Start');
          await Popup.resetList();
          await Popup.postMessage({reload: true});
        });

        // Close/Hide logs box
        const hideLogs = await Common.getElement('#progress-logs > button');
        hideLogs.addEventListener('click', async () => {
          await Common.setLocalStorage({logsBoxIsHidden: true});
          await Popup.hideLogs();
        });

        // Find issues on the page
        chrome.runtime.onConnect.addListener((port) => {
          if (port.name === 'oxyplug-tech-seo-audit') {
            port.onMessage.addListener((request) => {
              new Promise(async (resolve, reject) => {
                try {
                  if (request.log) {
                    await Popup.addToLogsList(request.log);
                  } else if (request.progress) {
                    await Popup.progress(request.progress);
                  } else {
                    await Common.setLocalStorage({is_processing: false});
                    await Popup.processingState(false);

                    if (request.issues) {
                      // Fill issues list
                      Popup.issues = request.issues;

                      await Popup.loadList(request.issues);
                      await Popup.renameStart('Restart');
                      Popup.stop.disabled = false;
                      Popup.purgeReload.disabled = false;
                      await Popup.highlightActiveUrl();
                      await Popup.highlightActiveFilter();
                      const log = 'Auditing finished.';
                      await Popup.addToLogsList(log);
                      await Popup.progress(100);

                      // Fill issues history
                      await Popup.loadIssuesHistoryList(request.allIssues);
                    } else if (request.showIssues) {
                      await Common.showIssues(request.showIssues, request.issueTypes, 'popup');
                    }
                  }

                  resolve({status: true});
                } catch (error) {
                  console.log(error);
                  reject(error);
                }
              });
            });
          }
        });

        if (Popup.issues && Object.keys(Popup.issues).length) {
          Popup.stop.disabled = false;
        }

        // Navigation between the pages
        const navButtons = await Common.getElements('nav button');
        navButtons.forEach((navButton) => {
          navButton.addEventListener('click', async (el) => {

            // Highlight the active button
            const buttons = await navButton.parentElement.querySelectorAll('button');
            buttons.forEach((button) => {
              button.classList.remove('button-active');
            });
            el.target.classList.add('button-active');

            // Change page/content
            const sectionId = navButton.dataset.target;
            const content = await Common.getElement('#content');
            const pages = content.querySelectorAll(':scope > div');
            pages.forEach((page) => {
              page.style.display = page.id === sectionId ? 'block' : 'none';
            });

          }, false);
        });

        // Filters
        const filters = await Common.getElement('.oxyplug-tabs');
        const filterButtons = filters.querySelectorAll(':scope > button');
        filterButtons.forEach((filterButton) => {
          filterButton.addEventListener('click', async (el) => {
            el = el.currentTarget;

            // Change active button color
            const activeButtons = filters.querySelectorAll(':scope > button.active');
            activeButtons.forEach((activeButton) => {
              activeButton.classList.remove('active');
            });
            el.classList.add('active');

            // Store to highlight when popup pops up
            await Common.setLocalStorage({active_filter: el.id});

            // Filter the list
            const filterTarget = 'data-' + el.id;
            const issueListItems = await Common.getElements('#oxyplug-issue-list > ul li');
            if (filterTarget === 'data-all-issue') {
              issueListItems.forEach((li) => {
                li.style.display = 'block';
              });
            } else {
              issueListItems.forEach((li) => {
                li.style.display = li.hasAttribute(filterTarget) ? 'block' : 'none';
              });
            }

          });
        });

        // Modal
        await Common.makeModalActions('oxyplug-modal-message');

        // Learn More
        await Popup.loadLearnMore();

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Open in new tab with a or javascript
   * @param ul
   * @param li
   * @param exclusion
   * @param button
   * @param type
   * @returns {Promise<void>}
   */
  static async openInNewTab(ul, li, exclusion, button, type = 1) {
    let completeSrc = exclusion;
    if (!completeSrc.startsWith('data:image')) {
      if (!completeSrc.startsWith('http')) {
        const currentTabUrl = new URL(Popup.currentTab.url);
        completeSrc = completeSrc.replace(/^\/+/, '');
        completeSrc = currentTabUrl.origin + '/' + completeSrc;
      }
      const currentPageUrl = new URL(completeSrc);
      currentPageUrl.searchParams.set('by-oxyplug-tech-seo', 'true');
      completeSrc = currentPageUrl.toString();
    }

    // Open in new tab
    const a = document.createElement('a');
    a.classList.add('oxyplug-icon-new-tab');
    if (completeSrc.startsWith('data:image')) {
      a.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.myWindow || window.myWindow.closed) {
          window.myWindow = window.open('');
          if (window.myWindow) {
            // Build the node directly instead of document.write to avoid
            // injecting markup from an untrusted (page-derived) src.
            const img = window.myWindow.document.createElement('img');
            img.src = completeSrc;
            window.myWindow.document.body.appendChild(img);
          }
        } else {
          window.myWindow.focus();
        }
      };
      if (type === 2) {
        li.prepend(a);
      }
    } else {
      a.href = completeSrc;
      a.target = '_blank';
      a.onclick = (e) => {
        e.stopPropagation();
      };
      if (type === 2) {
        li.prepend(a);
      }
    }

    if (type === 1) {
      li.prepend(a, button);
      ul.append(li);
    }
  }

  /**
   * Init data when popup pops up
   * @returns {Promise<unknown>}
   */
  static async initData() {
    return new Promise(async (resolve, reject) => {
      try {
        // Load issues on the page (From Storage)
        Popup.issues = await Common.getLocalStorage('issues');
        if (Popup.issues && Object.keys(Popup.issues).length) {
          // Check if the current issues is related to the current page
          if (Popup.issues.audit.page === Popup.currentHref) {
            Popup.purgeReload.disabled = false;
            await Popup.renameStart('Restart');
            await Popup.loadList(Popup.issues);
            await Popup.loadLogs();
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
   * Post message
   * @param data
   * @returns {Promise<void>}
   */
  static async postMessage(data) {
    Popup.port = chrome.tabs.connect(Popup.currentTab.id, {name: 'oxyplug-tech-seo-audit'});
    Popup.port.postMessage(data);
  }

  /**
   * Show spinner, hide list, disable start button
   * @returns {Promise<void>}
   */
  static async processingState(isProcessing = true) {
    return new Promise(async (resolve, reject) => {
      try {
        if (isProcessing) {
          await Popup.toggleSpinner('block');
          await Popup.toggleList('none');
          Popup.start.disabled = Popup.purgeReload.disabled = true;
          Popup.stop.disabled = false;
        } else {
          await Popup.toggleSpinner('none');
          await Popup.toggleList('block');
          Popup.start.disabled = Popup.purgeReload.disabled = false;
          Popup.stop.disabled = true;
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   *
   * @param text
   * @param length
   * @param putAfter
   * @returns {Promise<string|*>}
   */
  static async getExcerpt(text, length = 50, putAfter = '...') {
    return new Promise((resolve, reject) => {
      try {
        if (text.length > length) {
          return resolve(text.substring(0, length) + putAfter);
        }

        resolve(text);
      } catch (error) {
        console.log(error);
        reject(text);
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
   * Highlight active url
   * @returns {Promise<void>}
   */
  static async highlightActiveUrl() {
    return new Promise(async (resolve, reject) => {
      try {
        const activeUrl = await Common.getLocalStorage('active_url');
        if (activeUrl) {
          const li = await Common.getElement('#oxyplug-issue-list > ul li[data-target="' + activeUrl + '"]');
          if (li) {
            li.classList.add('active');
          }
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  };

  /**
   * Highlight active filter
   * @returns {Promise<void>}
   */
  static async highlightActiveFilter() {
    return new Promise(async (resolve, reject) => {
      try {
        const activeFilter = await Common.getLocalStorage('active_filter');
        if (activeFilter) {
          const li = await Common.getElement('#oxyplug-issue-list #' + activeFilter);
          if (li) {
            li.classList.add('active');
          }
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  };

  /**
   * Clear the list and reset the data stored in localStorage
   * @returns {Promise<unknown>}
   */
  static async resetList() {
    return new Promise(async (resolve) => {
      if (Popup.issues && Object.keys(Popup.issues).length) {
        Popup.issues['issues'] = {};
        if (Popup.issues['count']) {
          for (const key of Object.keys(Popup.issues['count'])) {
            Popup.issues['count'][key] = 0;
            await Popup.updateFilters(key, 0);
          }
          await Popup.updateFilters('all-issue', 0);
        }
        await Common.setLocalStorage({issues: Popup.issues});
        const issueList = await Common.getElement('#oxyplug-issue-list > ul');
        issueList.innerHTML = '';
      }

      resolve();
    });
  }

  /**
   * Load the list of issues
   * @param issues
   * @returns {Promise<void>}
   */
  static async loadList(issues) {
    return new Promise(async (resolve, reject) => {
      try {
        const auditPage = issues.audit.page;
        const issuesCount = issues.count;
        issues = issues.issues;
        const issuesArray = Object.keys(issues);

        if (issuesArray.length) {
          // Sort
          issues = issuesArray.sort().reduce((obj, key) => {
            obj[key] = issues[key];
            return obj;
          }, {});

          // Empty the list of issues
          const issueList = await Common.getElement('#oxyplug-issue-list > ul');
          issueList.innerHTML = '';

          // Make the list of issues
          for (const [className, details] of Object.entries(issues)) {
            const liExists = issueList.querySelector(`[data-target="${className}"]`);
            let completeSrc = details.url;
            const srcExcerpt = await Popup.getExcerpt(completeSrc, 256);
            let li;
            if (liExists) {
              li = liExists;
              for (const [dataset] of Object.entries(li.dataset)) {
                if (dataset.slice(-5).toLowerCase() == 'issue') {
                  delete li.dataset[dataset];
                }
              }
            } else {
              li = document.createElement('li');
              li.classList.add('button');
              li.dataset.target = className;
            }

            details.issueTypes.forEach((issueType) => {
              li.dataset[issueType] = 1;
            });
            li.title = srcExcerpt;
            li.onclick = (el) => {
              const liActive = issueList.querySelector('li.active');
              if (liActive) {
                liActive.classList.remove('active');
              }

              el.target.classList.add('active');
              Common.setLocalStorage({active_url: className});

              if (auditPage === Popup.currentHref) {
                Popup.postMessage({scrollTo: className});
              }

              Popup.postMessage({
                messages: details.messages,
                issueTypes: details.issueTypes
              });
            };

            const span = document.createElement('span');
            span.innerText = decodeURI(srcExcerpt);
            li.append(span);

            // Filter the list
            const filterTarget = 'data-' + await Common.getLocalStorage('active_filter');
            if (filterTarget == 'data-all-issue') {
              li.style.display = 'block';
            } else {
              li.style.display = li.hasAttribute(filterTarget) ? 'block' : 'none';
            }

            if (!liExists) {
              // Exclude image button
              const exclusionsEl = await Common.getElement('#exclusions');
              const exclusionsUl = await exclusionsEl.querySelector(':scope > ul');
              const excludeButton = document.createElement('button');
              excludeButton.classList.add('oxyplug-icon-exclude');
              excludeButton.onclick = async (e) => {
                e.stopPropagation();
                const parent = e.target.parentNode;
                if (Popup.issues && Object.keys(Popup.issues).length) {
                  const item = Popup.issues['issues'][parent.dataset.target];
                  if (item) {
                    // Exclude src
                    const exclusion = item['url'];
                    let exclusions = await Common.getLocalStorage('exclusions');
                    if (!exclusions || Object.keys(exclusions).length === 0) {
                      exclusions = {[Popup.currentHref]: [exclusion]};
                    } else {
                      const exclusionsKey = Object.keys(exclusions);
                      // Delete one href not to make it bigger than 10
                      if (exclusionsKey.length === 10) {
                        const anHref = exclusionsKey[0];
                        delete exclusions[anHref];
                      }

                      if (!exclusions[Popup.currentHref])
                        exclusions[Popup.currentHref] = [exclusion];
                      else if (!exclusions[Popup.currentHref].includes(exclusion))
                        exclusions[Popup.currentHref].push(exclusion);
                    }

                    await Common.setLocalStorage({exclusions});

                    // Reset issue list
                    const keys = [];
                    for (const key in Popup.issues['issues']) {
                      if (Popup.issues['issues'][key].url === exclusion) {
                        keys.push(key);
                        await issueList.querySelector(`li[data-target="${key}"]`).remove();
                      }
                    }

                    // Add exclusion to the exclusions list
                    const exclusionLi = document.createElement('li');
                    exclusionLi.innerText = decodeURI(exclusion);

                    // Remove
                    const button = document.createElement('button');
                    button.classList.add('oxyplug-icon-bin');
                    button.onclick = async (e) => {
                      e.stopPropagation();
                      const exclusions = await Common.getLocalStorage('exclusions');
                      const index = exclusions[Popup.currentHref].indexOf(exclusion);
                      if (index !== -1) {
                        exclusions[Popup.currentHref].splice(index, 1);
                        await Common.setLocalStorage({exclusions});
                        exclusionLi.remove();
                      }

                      // No exclusions.
                      const p = document.createElement('p');
                      p.innerText = 'No exclusions.';
                      if (!await exclusionsUl.querySelector('li')) {
                        exclusionsEl.append(p);
                      }
                    };

                    // Make complete src to be able to show in new tab
                    await Popup.openInNewTab(exclusionsUl, exclusionLi, exclusion, button);

                    const noExclusionsEl = await exclusionsEl.querySelector('p');
                    if (noExclusionsEl) {
                      noExclusionsEl.remove();
                    }

                    // Remove exclusions from localStorage and issues list
                    const issueTypes = item['issueTypes'];
                    for (const key of keys) {
                      for (const issueType of issueTypes) {
                        const issueTypeKey = issueType.replace(/([A-Z])/g, '-$1').toLowerCase();
                        Popup.issues['count'][issueTypeKey] -= 1;
                        const el = await Common.getElement(`#${issueTypeKey} .has-issue`);
                        el.innerText = Popup.issues['count'][issueTypeKey];
                      }
                      delete Popup.issues['issues'][key];

                      // Decrease all-issue
                      const allIssueEl = await Common.getElement('#all-issue .has-issue');
                      allIssueEl.innerText = parseInt(allIssueEl.innerText) - 1;
                    }

                    // To make issues & last item of all_issues the same
                    const allIssues = await Common.getLocalStorage('all_issues');
                    allIssues[allIssues.length - 1] = Popup.issues;

                    // Store in localstorage
                    await Common.setLocalStorage({issues: Popup.issues, all_issues: allIssues});
                  }
                }

                const exclusionAlreadyAlerted = Boolean(await Common.getLocalStorage('exclusion_already_alerted'));
                if (exclusionAlreadyAlerted === false) {
                  await Common.setLocalStorage({exclusion_already_alerted: true});
                  alert(
                    "This image src got excluded and won't be audited anymore.\n" +
                    "You can include it again in exclusions tab.\n"
                  );
                }
              };
              li.prepend(excludeButton);

              // Make complete src to be able to show in new tab
              await Popup.openInNewTab(exclusionsUl, li, completeSrc, excludeButton, 2);

              issueList.append(li);
            }
          }

          // Highlight active url
          await Popup.highlightActiveUrl();
        }

        // Show issues count on filters
        for (const [id, count] of Object.entries(issuesCount)) {
          // Update *-issue filters
          await Popup.updateFilters(id, count);
        }

        // Update all-issue filter
        await Popup.updateFilters('all-issue', issuesArray.length);

        // Highlight active filter
        await Popup.highlightActiveFilter();

        // Hide processing state and show result
        await Popup.processingState(false);

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
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
   * Update filters
   * @param id
   * @param count
   * @returns {Promise<void>}
   */
  static async updateFilters(id, count) {
    return new Promise(async (resolve, reject) => {
      try {
        const span = await Common.getElement('#' + id + ' > span');
        span.innerText = count > 99 ? '+99' : count;

        if (count > 0) {
          span.classList.add('has-issue');
        } else {
          span.classList.remove('has-issue');
        }

        if (['next-gen-formats-issue', 'lazy-load-issue', 'preload-lcp-issue'].includes(id)) {
          span.classList.add('warning');
        } else if (['lcp-issue', 'decoding-issue'].includes(id)) {
          span.classList.add('info');
        }

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }

  /**
   * Show/Hide the loading spinner
   * @param status
   * @returns {Promise<void>}
   */
  static async toggleSpinner(status) {
    const isProcessing = await Common.getElement('#oxyplug-is-processing');
    isProcessing.style.display = status;
  };

  /**
   * Show/Hide the list of issues
   * @param status
   * @returns {Promise<void>}
   */
  static async toggleList(status) {
    return new Promise(async (resolve, reject) => {
      try {
        const issueList = await Common.getElement('#oxyplug-issue-list');
        issueList.querySelector('.oxyplug-tabs').style.display = status;
        issueList.querySelector(':scope > ul').style.display = status;

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
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
   * Rename `Start` button
   * @returns {Promise<void>}
   */
  static async renameStart(text) {
    Popup.start.innerText = text;
  };

  /**
   * Hide logs
   * @returns {Promise<void>}
   */
  static async hideLogs() {
    const logsBox = await Common.getElement('#progress-logs');
    logsBox.style.display = 'none';
  }

  /**
   * Get current tab domain i.e. location.hostname
   * @returns {Promise<string|null>}
   */
  static async getCurrentHost(currentTab) {
    return new Promise((resolve, reject) => {
      try {
        if (currentTab && currentTab.url) {
          return resolve(new URL(currentTab.url).hostname);
        }

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
   * Get current tab href i.e. location.href
   * @returns {Promise<string|null>}
   */
  static async getCurrentHref(currentTab) {
    return new Promise((resolve, reject) => {
      try {
        if (currentTab && currentTab.url) {
          return resolve(new URL(currentTab.url).href);
        }

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
   * Clear logs from localStorage and list
   * @returns {Promise<void>}
   */
  static async clearLogs() {
    // localStorage
    const logs = await Common.getLocalStorage('logs');
    if (logs && logs[Popup.currentHost]) {
      delete logs[Popup.currentHost];
      await Common.setLocalStorage({logs});
    }

    // List
    const progressLogsListEl = await Common.getElement('#progress-logs > ul');
    progressLogsListEl.innerHTML = '';
  }

  /**
   * Show logs list
   * @returns {Promise<void>}
   */
  static async showLogs() {
    const logsBoxIsHidden = await Common.getLocalStorage('logsBoxIsHidden');
    if (logsBoxIsHidden === false) {
      const progressLogsEl = await Common.getElement('#progress-logs');
      progressLogsEl.style.display = 'block';
    }
  }

  /**
   * Load logs
   * @returns {Promise<void>}
   */
  static async loadLogs() {
    const logs = await Common.getLocalStorage('logs');
    if (logs && logs[Popup.currentHost]) {
      for (const logText of logs[Popup.currentHost]) {
        await Popup.addToLogsList(logText);
      }
      await Popup.showLogs();
    }
  }

  /**
   * Add log to the list
   * @param text
   * @returns {Promise<void>}
   */
  static async addToLogsList(text) {
    const newLi = document.createElement('li');
    newLi.innerText = text;
    const progressLogsListEl = await Common.getElement('#progress-logs > ul');
    const progressLogsListItem = progressLogsListEl.querySelectorAll('li');
    let found = false;
    for (let e = 0; e < progressLogsListItem.length; e++) {
      const element = progressLogsListItem[e];
      if (element.textContent.includes(text)) {
        found = true;
        break;
      }
    }

    if (!found) {
      progressLogsListEl.append(newLi);
    }
  }

  /**
   * Update progress bar
   * @param percent
   * @returns {Promise<void>}
   */
  static async progress(percent) {
    const auditProgress = await Common.getElement('#audit-progress');
    auditProgress.querySelector('div').style.width = `${percent}%`;
    auditProgress.querySelector('span').innerText = `${percent}%`;
  }

  /**
   * Load learn more
   * @returns {Promise<void>}
   */
  static async loadLearnMore() {
    await Common.setLearnMores(Popup.currentHost);
    const learnMoreList = await Common.getElement('#learn ul');
    const utmLink = Common.learnMores['utm-link'];
    for (const [_, messageObject] of Object.entries(Common.learnMores['issues'])) {
      for (const [key, message] of Object.entries(messageObject)) {

        // li
        const li = document.createElement('li');
        li.innerText = message + ' ';

        // a
        const a = document.createElement('a');
        a.href = `${utmLink}${key}#${key}`;
        a.target = '_blank';
        a.innerText = 'Learn More';

        // append
        li.append(a);
        learnMoreList.append(li);
      }
    }
  }

  /**
   * Load history list of the issues
   * @param allIssues
   * @returns {Promise<unknown>}
   */
  static async loadIssuesHistoryList(allIssues = null) {
    return new Promise(async (resolve, reject) => {
      try {
        if (allIssues === null) {
          allIssues = await Common.getLocalStorage('all_issues');
        }

        let requestAnimationFrameId = null;

        const startMarquee = (span) => {
          const currentPosition = parseFloat(span.style.left);
          if (currentPosition < -(span.clientWidth - span.dataset.left)) {
            span.style.left = `${span.dataset.left}px`;
          } else {
            span.style.left = currentPosition - 1 + 'px';
          }
          requestAnimationFrameId = requestAnimationFrame(() => startMarquee(span));
        }

        const stopMarquee = (span) => {
          cancelAnimationFrame(requestAnimationFrameId);
          span.style.left = `${span.dataset.left}px`;
        }

        const refreshList = async () => {
          // Clear the list
          const issuesHistoryList = await Common.getElement('#history ul');
          issuesHistoryList.innerHTML = '';

          // Remove no issues <p>
          const noIssuesHistory = await Common.getElement('#history > p');
          if (noIssuesHistory) {
            noIssuesHistory.remove();
          }

          if (allIssues && allIssues.length) {
            allIssues.forEach((issues, key) => {
              // li
              const li = document.createElement('li');
              li.classList.add('button');

              // Open in new tab
              const a = document.createElement('a');
              a.classList.add('oxyplug-icon-new-tab');
              a.href = issues.audit.page;
              a.target = '_blank';

              // button
              const button = document.createElement('button');
              button.classList.add('oxyplug-icon-bin');
              button.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = confirm('Are you sure?');
                if (confirmed) {
                  allIssues.splice(key, 1);
                  await Common.setLocalStorage({all_issues: allIssues});
                  await refreshList();
                }
              }

              // date span
              const dateSpan = document.createElement('span');
              dateSpan.innerText = `${issues.audit.date} - `;

              // div
              const div = document.createElement('div');
              div.classList.add('similar-style');
              div.append(a, button, dateSpan);
              li.append(div);

              // span
              const span = document.createElement('span');
              span.innerText = decodeURI(issues.audit.page);

              // li listeners
              li.onmouseenter = () => {
                if (li.scrollWidth > li.clientWidth) {
                  span.style.left = `${span.dataset.left}px`;
                  requestAnimationFrameId = requestAnimationFrame(() => startMarquee(span));
                }
              };
              li.onmouseleave = () => {
                stopMarquee(span);
              };
              li.onclick = async () => {
                await Popup.loadList(issues);
                const homeButton = await Common.getElement('.oxyplug-section button.oxyplug-icon-home');
                homeButton.click();
                stopMarquee(span);
              };

              // append
              li.append(span);
              issuesHistoryList.prepend(li);
            });

            // Keep div `width` to reset span `left`
            const historyPage = await Common.getElement('#history');
            setTimeout(() => {

              const alreadyDisplayed = historyPage.style.display === 'block';
              if (!alreadyDisplayed) {
                historyPage.style.display = 'block';
              }

              issuesHistoryList.querySelectorAll('li').forEach(li => {
                const div = li.querySelector('div');
                const span = li.querySelector(':scope > span');
                const divWidth = div.clientWidth + 3;
                span.dataset.left = divWidth + '';
                span.style.left = `${divWidth}px`;
              });

              if (!alreadyDisplayed) {
                historyPage.style.display = 'none';
              }
            }, 100);
          } else {
            const p = document.createElement('p');
            p.innerText = 'No audits yet.';
            issuesHistoryList.insertAdjacentElement('beforebegin', p);
          }
        }

        await refreshList();

        resolve();
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  }
}

Popup.init()
  .then(() => {
    console.log('Popup init');
  })
  .catch(() => {
    console.log('Popup error');
  });