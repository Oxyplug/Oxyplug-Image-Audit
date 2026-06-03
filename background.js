class Background {
  /**
   * Record the filesize (or load failure) for a single image request.
   * Reads the existing maps from storage and merges into them so previously
   * captured images are preserved (MV3 service workers are short-lived and
   * keep no in-memory state between events).
   * @param details
   * @returns {Promise<void>}
   */
  static async setFileSizes(details) {
    const currentTab = await Background.getCurrentTab();

    // Only record images that belong to the tab currently being audited.
    if (!currentTab || details.tabId !== currentTab.id) {
      return;
    }

    const loadFails = (await Background.getLocalStorage('load_fails')) ?? {};
    const imageFilesizes = (await Background.getLocalStorage('image_filesizes')) ?? {};

    // Image loaded
    if (details.statusCode === 200) {
      // Unset it if it was previously failed to load
      if (loadFails[details.url]) {
        delete loadFails[details.url];
        await Background.setLocalStorage({load_fails: loadFails});
      }

      // Do not add filesize if it has already been added
      if (!imageFilesizes[details.url]) {
        let filesize = 0;

        details.responseHeaders.forEach((item) => {
          if (item.name.toLowerCase() === 'content-length') {
            filesize = Number(item.value) / 1000;
          }
        });

        // add filesize
        imageFilesizes[details.url] = filesize;
        await Background.setLocalStorage({image_filesizes: imageFilesizes});
      }
    } else {
      if (imageFilesizes[details.url]) {
        delete imageFilesizes[details.url];
        await Background.setLocalStorage({image_filesizes: imageFilesizes});
      }

      loadFails[details.url] = details.statusCode;
      await Background.setLocalStorage({load_fails: loadFails});
    }
  }

  /**
   * Get current tab
   * @returns {Promise<chrome.tabs.Tab|null>}
   */
  static async getCurrentTab() {
    try {
      const queryOptions = {active: true, currentWindow: true};
      const [tab] = await chrome.tabs.query(queryOptions);
      return tab ?? null;
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  /**
   * Get local storage
   * @param key
   * @returns {Promise<unknown>}
   */
  static async getLocalStorage(key) {
    try {
      const response = await chrome.storage.local.get(key);
      return response[key];
    } catch (error) {
      console.log(error);
      return null;
    }
  }

  /**
   * Set local storage
   * @param object
   * @returns {Promise<boolean>}
   */
  static async setLocalStorage(object) {
    try {
      await chrome.storage.local.set(object);
      return true;
    } catch (error) {
      console.log(error);
      return false;
    }
  }
}

/**
 * Register the listener synchronously at the top level so it is re-attached
 * every time the service worker is (re)started by the browser. The work is
 * delayed slightly to give the response a chance to settle before the headers
 * are read.
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    setTimeout(() => {
      Background.setFileSizes(details);
    }, 1000);
  },
  {urls: ['<all_urls>'], types: ['image']},
  ['responseHeaders']
);

console.log('Background init');
