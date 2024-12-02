// ==UserScript==
// @name         Filterboxd
// @namespace    https://github.com/blakegearin/filterboxd
// @version      0.9.2
// @description  Filter content on Letterboxd
// @author       Blake Gearin
// @match        https://letterboxd.com/*
// @require      https://openuserjs.org/src/libs/sizzle/GM_config.js
// @grant        GM.getValue
// @grant        GM.setValue
// @license      MIT
// @icon         https://raw.githubusercontent.com/blakegearin/filterboxd/main/img/logo.svg
// @supportURL   https://github.com/blakegearin/filterboxd/issues
// ==/UserScript==

/*global GM_config*/

(function() {
  'use strict';

  const RESET = false;

  const SILENT = 0;
  const QUIET = 1;
  const INFO = 2;
  const DEBUG = 3;
  const VERBOSE = 4;
  const TRACE = 5;

  let CURRENT_LOG_LEVEL = INFO;

  const USERSCRIPT_NAME = 'Filterboxd';

  function log(level, message, variable = -1) {
    if (CURRENT_LOG_LEVEL < level) return;

    console.log(`${USERSCRIPT_NAME}: ${message}`);
    if (variable !== -1) console.log(variable);
  }

  function logError(message, variable = null) {
    console.error(`${USERSCRIPT_NAME}: ${message}`);
    if (variable) console.log(variable);
  }

  log(TRACE, 'Starting');

  function updateLogLevel() {
    CURRENT_LOG_LEVEL = {
      silent: SILENT,
      quiet: QUIET,
      info: INFO,
      debug: DEBUG,
      verbose: VERBOSE,
      trace: TRACE,
    }[GMC.get('logLevel')];
  }

  function startObserving() {
    log(DEBUG, 'startObserving()');

    OBSERVER.observe(
      document.body,
      {
        childList: true,
        subtree: true,
      },
    );
  }

  function modifyThenObserve(callback) {
    log(DEBUG, 'modifyThenObserve()');

    OBSERVER.disconnect();
    callback();
    startObserving();
  }

  function observeAndModify(mutationsList) {
    log(VERBOSE, 'observeAndModify()');

    if (IDLE_MUTATION_COUNT > MAX_IDLE_MUTATIONS) {
      // This is a failsafe to prevent infinite loops
      logError('MAX_IDLE_MUTATIONS exceeded');
      OBSERVER.disconnect();

      return;
    } else if (UPDATES_COUNT >= MAX_HEADER_UPDATES) {
      // This is a failsafe to prevent infinite loops
      logError('MAX_HEADER_UPDATES exceeded');
      OBSERVER.disconnect();

      return;
    }

    for (const mutation of mutationsList) {
      // Use header id to determine if updates have already been applied
      if (mutation.type !== 'childList') return;

      log(TRACE, 'mutation', mutation);

      maybeAddListItemToSidebar();
      const outcome = addListItemToPopMenu();
      applyFilters();

      log(DEBUG, 'outcome', outcome);

      if (outcome === 'continue') continue;
      if (outcome === 'break') break;
    }
  }

  function createId(string) {
    log(TRACE, 'createId()');

    if (string.startsWith('#')) return string;

    if (string.startsWith('.')) {
      logError(`Attempted to create an id from a class: "${string}"`);
      return;
    }

    if (string.startsWith('[')) {
      logError(`Attempted to create an id from an attribute selector: "${string}"`);
      return;
    }

    return `#${string}`;
  }

  const MAX_IDLE_MUTATIONS = 100;
  const MAX_HEADER_UPDATES = 100;
  const FILM_BEHAVIORS = [
    'Remove',
    'Fade',
    'Blur',
    'Replace poster',
    'Custom',
  ];
  const REVIEW_BEHAVIORS = [
    'Remove',
    'Fade',
    'Blur',
    'Replace text',
    'Custom',
  ];

  let IDLE_MUTATION_COUNT = 0;
  let UPDATES_COUNT = 0;
  let SELECTORS = {
    filmPosterPopMenu: {
      self: '.film-poster-popmenu',
      userscriptListItemClass: 'filterboxd-list-item',
      addToList: '.film-poster-popmenu .menu-item-add-to-list',
      addThisFilm: '.film-poster-popmenu .menu-item-add-this-film',
    },
    filterTitleClass: 'filterboxd-filter-title',
    processedClass: {
      apply: 'filterboxd-hide-processed',
      remove: 'filterboxd-unhide-processed',
    },
    settings: {
      clear: '.clear',
      favoriteFilms: '.favourite-films-selector',
      filteredTitleLinkClass: 'filtered-title-span',
      note: '.note',
      posterList: '.poster-list',
      removePendingClass: 'remove-pending',
      savedBadgeClass: 'filtered-saved',
      subNav: '.sub-nav',
      subtitle: '.mob-subtitle',
      tabbedContentId: '#tabbed-content',
    },
    userpanel: {
      self: '#userpanel',
      userscriptListItemId: 'filterboxd-list-item',
      addThisFilm: '#userpanel .add-this-film',
    },
  };

  function addListItemToPopMenu() {
    log(DEBUG, 'addListItemToPopMenu()');

    const filmPosterPopMenus = document.querySelectorAll(SELECTORS.filmPosterPopMenu.self);

    if (!filmPosterPopMenus) {
      log(`Selector ${SELECTORS.filmPosterPopMenu.self} not found`, DEBUG);
      return 'break';
    }

    filmPosterPopMenus.forEach(filmPosterPopMenu => {
      const userscriptListItem = filmPosterPopMenu.querySelector(`.${SELECTORS.filmPosterPopMenu.userscriptListItemClass}`);
      if (userscriptListItem) return;

      const lastListItem = filmPosterPopMenu.querySelector('li:last-of-type');

      if (!lastListItem) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu} li:last-of-type not found`);
        return 'break';
      }

      const addToListLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addToList);
      if (!addToListLink) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu.addToList} not found`);
        return 'break';
      }

      const addThisFilmLink = filmPosterPopMenu.querySelector(SELECTORS.filmPosterPopMenu.addThisFilm);
      if (!addThisFilmLink) {
        logError(`Selector ${SELECTORS.filmPosterPopMenu.addThisFilm} not found`);
        return 'break';
      }

      modifyThenObserve(() => {
        let userscriptListItem = lastListItem.cloneNode(true);
        userscriptListItem.classList.add(SELECTORS.filmPosterPopMenu.userscriptListItemClass);

        userscriptListItem = buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink);
        lastListItem.parentNode.append(userscriptListItem);
      });
    });

    return;
  }

  function addTitle({ id, slug }) {
    log(DEBUG, 'addTitle()');

    const idMatch = `[data-film-id="${id}"]`;
    let appliedSelector = `.${SELECTORS.processedClass.apply}`;

    const replaceBehavior = GMC.get('filmBehaviorType') === 'Replace poster';
    log(VERBOSE, 'replaceBehavior', replaceBehavior);

    if (replaceBehavior) appliedSelector = '[data-original-img-src]';

    // Activity page reviews
    document.querySelectorAll(`section.activity-row ${idMatch}`).forEach(posterElement => {
      applyFilterToElement(posterElement, 3);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(${appliedSelector})`).forEach(posterElement => {
      applyFilterToElement(posterElement, 3);
    });

    // New from friends
    document.querySelectorAll(`.poster-container ${idMatch}:not(${appliedSelector})`).forEach(posterElement => {
      applyFilterToElement(posterElement, 1);
    });

    // Reviews
    document.querySelectorAll(`.review-tile ${idMatch}:not(${appliedSelector})`).forEach(posterElement => {
      applyFilterToElement(posterElement, 3);
    });

    // Diary
    document.querySelectorAll(`.td-film-details [data-original-img-src]${idMatch}:not(${appliedSelector})`).forEach(posterElement => {
      applyFilterToElement(posterElement, 2);
    });

    // Popular with friends, competitions
    const remainingElements = document.querySelectorAll(
      `div:not(.popmenu):not(.actions-panel) ${idMatch}:not(aside [data-film-id="${id}"]):not(${appliedSelector})`,
    );
    remainingElements.forEach(posterElement => {
      applyFilterToElement(posterElement, 0);
    });
  }

  function addToHiddenTitles(titleMetadata) {
    log(DEBUG, 'addToHiddenTitles()');

    const filmFilter = getFilter('filmFilter');
    filmFilter.push(titleMetadata);
    log(VERBOSE, 'filmFilter', filmFilter);

    setFilter('filmFilter', filmFilter);
  }

  function applyFilters() {
    log(DEBUG, 'applyFilters()');

    const filmFilter = getFilter('filmFilter');
    log(VERBOSE, 'filmFilter', filmFilter);

    modifyThenObserve(() => {
      filmFilter.forEach(titleMetadata => addTitle(titleMetadata));
    });
  }

  function applyFilterToElement(element, levelsUp = 0) {
    log(DEBUG, 'applyFilterToElement()');

    const replaceBehavior = GMC.get('filmBehaviorType') === 'Replace poster';
    log(VERBOSE, 'replaceBehavior', replaceBehavior);

    if (replaceBehavior) {
      const filmBehaviorReplaceValue = GMC.get('filmBehaviorReplaceValue');
      log(VERBOSE, 'filmBehaviorReplaceValue', filmBehaviorReplaceValue);

      const elementImg = element.querySelector('img');
      if (!elementImg) return;

      const originalImgSrc = elementImg.src;
      if (!originalImgSrc) return;

      if (originalImgSrc === filmBehaviorReplaceValue) return;

      element.setAttribute('data-original-img-src', originalImgSrc);

      element.querySelector('img').src = filmBehaviorReplaceValue;
      element.querySelector('img').srcset = filmBehaviorReplaceValue;

      element.classList.add(SELECTORS.processedClass.apply);
    } else {
      let target = element;

      for (let i = 0; i < levelsUp; i++) {
        if (target.parentNode) {
          target = target.parentNode;
        } else {
          break;
        }
      }

      log(VERBOSE, 'target', target);

      target.classList.add(SELECTORS.filterTitleClass);
      element.classList.add(SELECTORS.processedClass.apply);
    }
  }

  function buildBehaviorFormRows(parentDiv, filterType, selectArrayValues, behaviorsMetadata) {
    const behaviorValue = GMC.get(`${filterType}BehaviorType`);
    log(DEBUG, 'behaviorValue', behaviorValue);

    const behaviorChange = (event) => {
      const filmBehaviorType = event.target.value;
      updateBehaviorCSSVariables(filterType, filmBehaviorType);
    };

    const columnOneWidth = '33%';
    const columnTwoWidth = '64.8%';

    const behaviorFormRow = createFormRow({
      formRowStyle: `width: ${columnOneWidth};`,
      labelText: 'Behavior',
      inputValue: behaviorValue,
      inputType: 'select',
      selectArray: selectArrayValues,
      selectOnChange: behaviorChange,
    });

    parentDiv.appendChild(behaviorFormRow);

    // Fade amount
    const behaviorFadeAmount = parseInt(GMC.get(behaviorsMetadata.fade.fieldName));
    log(DEBUG, 'behaviorFadeAmount', behaviorFadeAmount);

    const fadeAmountFormRow = createFormRow({
      formRowClass: ['update-details'],
      formRowStyle: `width: ${columnTwoWidth}; float: right; display: var(--filterboxd-${filterType}-behavior-fade);`,
      labelText: 'Amount',
      inputValue: behaviorFadeAmount,
      inputType: 'select',
      inputStyle: 'width: 100px !important;',
      selectArray: [ 0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90],
      notes: '%',
      notesStyle: 'width: 10px; margin-left: 14px;',
    });

    parentDiv.appendChild(fadeAmountFormRow);

    // Blur amount
    const behaviorBlurAmount = parseInt(GMC.get(behaviorsMetadata.blur.fieldName));
    log(DEBUG, 'behaviorBlurAmount', behaviorBlurAmount);

    const blurAmountFormRow = createFormRow({
      formRowClass: ['update-details'],
      formRowStyle: `width: ${columnTwoWidth}; float: right; display: var(--filterboxd-${filterType}-behavior-blur);`,
      labelText: 'Amount',
      inputValue: behaviorBlurAmount,
      inputType: 'select',
      inputStyle: 'width: 100px !important;',
      selectArray: [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 1000 ],
      notes: 'px',
      notesStyle: 'width: 10px; margin-left: 14px;',
    });

    parentDiv.appendChild(blurAmountFormRow);

    // Replace value
    const behaviorReplaceValue = GMC.get(behaviorsMetadata.replace.fieldName);
    log(DEBUG, 'behaviorReplaceValue', behaviorReplaceValue);

    const replaceValueFormRow = createFormRow({
      formRowStyle: `width: ${columnTwoWidth}; float: right; display: var(--filterboxd-${filterType}-behavior-replace);`,
      labelText: behaviorsMetadata.replace.labelText,
      inputValue: behaviorReplaceValue,
      inputType: 'text',
    });

    parentDiv.appendChild(replaceValueFormRow);

    // Custom CSS
    const behaviorCustomValue = GMC.get(behaviorsMetadata.custom.fieldName);
    log(DEBUG, 'behaviorCustomValue', behaviorCustomValue);

    const cssFormRow = createFormRow({
      formRowStyle: `width: ${columnTwoWidth}; float: right; display: var(--filterboxd-${filterType}-behavior-custom);`,
      labelText: 'CSS',
      inputValue: behaviorCustomValue,
      inputType: 'text',
    });

    parentDiv.appendChild(cssFormRow);

    return [
      behaviorFormRow,
      fadeAmountFormRow,
      blurAmountFormRow,
      replaceValueFormRow,
      behaviorCustomValue,
    ];
  }

  function buildListItemToggle(labelText, checked, filterName, fieldName) {
    const listItem = document.createElement('li');
    listItem.classList.add('option');

    const label = document.createElement('label');
    listItem.appendChild(label);

    label.classList.add('option-label', '-toggle', 'switch-control');

    const labelSpan = document.createElement('span');
    label.appendChild(labelSpan);

    labelSpan.classList.add('label');
    labelSpan.innerText = labelText;

    const labelInput = document.createElement('input');
    label.appendChild(labelInput);

    labelInput.classList.add('checkbox');
    labelInput.setAttribute('type', 'checkbox');
    labelInput.setAttribute('role', 'switch');
    labelInput.setAttribute('data-filter-name', filterName);
    labelInput.setAttribute('data-field-name', fieldName);
    labelInput.checked = checked;

    const labelCheckboxSpan = document.createElement('span');
    label.appendChild(labelCheckboxSpan);

    labelCheckboxSpan.classList.add('state');

    const checkboxTrackSpan = document.createElement('span');
    labelCheckboxSpan.appendChild(checkboxTrackSpan);

    checkboxTrackSpan.classList.add('track');

    const checkboxHandleSpan = document.createElement('span');
    checkboxTrackSpan.appendChild(checkboxHandleSpan);

    checkboxHandleSpan.classList.add('handle');

    return listItem;
  }

  function buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink) {
    const userscriptLink = userscriptListItem.firstElementChild;
    userscriptListItem.onclick = (event) => {
      event.preventDefault();
      log(DEBUG, 'userscriptListItem clicked');

      const link = event.target;

      const id = parseInt(link.getAttribute('data-film-id'));
      const slug = link.getAttribute('data-film-slug');
      const name = link.getAttribute('data-film-name');
      const year = link.getAttribute('data-film-release-year');

      const titleMetadata = {
        id,
        slug,
        name,
        year,
      };

      const titleIsHidden = link.getAttribute('data-title-hidden') === 'true';

      modifyThenObserve(() => {
        if (titleIsHidden) {
          removeTitle(titleMetadata);
          removeFromFilterTitles(titleMetadata);
        } else {
          addTitle(titleMetadata);
          addToHiddenTitles(titleMetadata);
        }

        updateLinkInPopMenu(!titleIsHidden, link);
      });
    };

    const titleId = parseInt(addToListLink.getAttribute('data-film-id'));
    userscriptLink.setAttribute('data-film-id', titleId);

    const filmAction = addToListLink.getAttribute('data-new-list-with-film-action');
    log(VERBOSE, 'filmAction', filmAction);

    const titleSlug = filmAction.split('/').at(-2);
    userscriptLink.setAttribute('data-film-slug', titleSlug);

    const titleName = addThisFilmLink.getAttribute('data-film-name');
    userscriptLink.setAttribute('data-film-name', titleName);
    const titleYear = addThisFilmLink.getAttribute('data-film-release-year');
    userscriptLink.setAttribute('data-film-release-year', titleYear);

    const titleIsHidden = getFilter('filmFilter').some(hiddenTitle => hiddenTitle.id === titleId);
    updateLinkInPopMenu(titleIsHidden, userscriptLink);

    userscriptLink.removeAttribute('class');

    return userscriptListItem;
  }

  function createFormRow({
    formRowClass = [],
    formRowStyle = '',
    labelText = '',
    inputValue = '',
    inputType = 'text',
    inputStyle = '',
    selectArray = [],
    selectOnChange = () => {},
    notes = '',
    notesStyle = '',
  }) {
    const formRow = document.createElement('div');
    formRow.classList.add('form-row');
    formRow.style.cssText = formRowStyle;
    formRow.classList.add(...formRowClass);

    const selectList = document.createElement('div');
    formRow.appendChild(selectList);

    selectList.classList.add('select-list');

    const label = document.createElement('label');
    selectList.appendChild(label);

    label.classList.add('label');
    label.textContent = labelText;

    const inputDiv = document.createElement('div');
    selectList.appendChild(inputDiv);

    inputDiv.classList.add('input');
    inputDiv.style.cssText = inputStyle;

    if (inputType === 'select') {
      const select = document.createElement('select');
      inputDiv.appendChild(select);

      select.classList.add('select');

      selectArray.forEach(option => {
        const optionElement = document.createElement('option');
        select.appendChild(optionElement);

        optionElement.value = option;
        optionElement.textContent = option;

        if (option === inputValue) optionElement.setAttribute('selected', 'selected');
      });

      select.onchange = selectOnChange;
    } else if (inputType === 'text') {
      const input = document.createElement('input');
      inputDiv.appendChild(input);

      input.type = 'text';
      input.classList.add('field');
      input.value = inputValue;
    }

    if (notes) {
      const notesElement = document.createElement('p');
      selectList.appendChild(notesElement);

      notesElement.classList.add('notes');
      notesElement.style.cssText = notesStyle;
      notesElement.textContent = notes;
    }

    return formRow;
  }

  function displaySavedBadge() {
    const savedBadge = document.querySelector(`.${SELECTORS.settings.savedBadgeClass}`);

    savedBadge.classList.remove('hidden');
    savedBadge.classList.add('fade');

    setTimeout(() => {
      savedBadge.classList.add('fade-out');
    }, 2000);

    setTimeout(() => {
      savedBadge.classList.remove('fade', 'fade-out');
      savedBadge.classList.add('hidden');
    }, 3000);
  }

  function getFilter(filterName) {
    return JSON.parse(GMC.get(filterName));
  }

  function gmcInitialized() {
    log(DEBUG, 'gmcInitialized()');

    updateLogLevel();

    log(QUIET, 'Running');

    GMC.css.basic = '';

    if (RESET) {
      log(QUIET, 'Resetting GMC');

      setFilter('filmFilter', []);
      setFilter('reviewFilter', {});

      GMC.reset();
      GMC.save();
    }

    let userscriptStyle = document.createElement('style');
    userscriptStyle.setAttribute('id', 'filterboxd-style');

    let behaviorStyle;
    let filmBehaviorType = GMC.get('filmBehaviorType');

    const filmBehaviorFadeAmount = GMC.get('filmBehaviorFadeAmount');
    log(VERBOSE, 'filmBehaviorFadeAmount', filmBehaviorFadeAmount);

    const filmBehaviorBlurAmount = GMC.get('filmBehaviorBlurAmount');
    log(VERBOSE, 'filmBehaviorBlurAmount', filmBehaviorBlurAmount);

    const filmBehaviorCustomValue = GMC.get('filmBehaviorCustomValue');
    log(VERBOSE, 'filmBehaviorCustomValue', filmBehaviorCustomValue);

    switch (filmBehaviorType) {
      case 'Remove':
        behaviorStyle = 'display: none !important;';
        break;
      case 'Fade':
        behaviorStyle = `opacity: ${filmBehaviorFadeAmount}%`;
        break;
      case 'Blur':
        behaviorStyle = `filter: blur(${filmBehaviorBlurAmount}px)`;
        break;
      case 'Custom':
        behaviorStyle = filmBehaviorCustomValue;
        break;
    }

    updateBehaviorCSSVariables('film', filmBehaviorType);

    let reviewBehaviorType = GMC.get('reviewBehaviorType');
    updateBehaviorCSSVariables('review', reviewBehaviorType);

    log(VERBOSE, 'behaviorStyle', behaviorStyle);

    userscriptStyle.textContent += `
      .${SELECTORS.filterTitleClass}
      {
        ${behaviorStyle}
      }

      .${SELECTORS.settings.filteredTitleLinkClass}
      {
        cursor: pointer;
        margin-right: 0.3rem !important;
      }

      .${SELECTORS.settings.filteredTitleLinkClass}:hover
      {
        background: #303840;
        color: #def;
      }

      .${SELECTORS.settings.removePendingClass}
      {
        outline: 1px dashed #ee7000;
        outline-offset: -1px;
      }

      .hidden {
        visibility: hidden;
      }

      .fade {
        opacity: 1;
        transition: opacity 1s ease-out;
      }

      .fade.fade-out {
        opacity: 0;
      }
    `;
    document.body.appendChild(userscriptStyle);

    applyFilters();
    maybeAddConfigurationToSettings();

    startObserving();
  }

  function maybeAddConfigurationToSettings() {
    log(DEBUG, 'maybeAddConfigurationToSettings()');

    const userscriptTabId = 'tab-filterboxd';
    const configurationExists = document.querySelector(createId(userscriptTabId));
    log(VERBOSE, 'configurationExists', configurationExists);

    const onSettingsPage = window.location.href.includes('/settings/');
    log(VERBOSE, 'onSettingsPage', onSettingsPage);

    if (!onSettingsPage || configurationExists) {
      log(DEBUG, 'Not in settings or Filterboxd configuration tab is present');

      return;
    }

    const userscriptTabDiv = document.createElement('div');

    const settingsTabbedContent = document.querySelector(SELECTORS.settings.tabbedContentId);
    settingsTabbedContent.appendChild(userscriptTabDiv);

    userscriptTabDiv.setAttribute('id', userscriptTabId);
    userscriptTabDiv.classList.add('tabbed-content-block');

    const tabTitle = document.createElement('h2');
    userscriptTabDiv.append(tabTitle);

    tabTitle.style.cssText = 'margin-bottom: 1em;';
    tabTitle.innerText = 'Filterboxd';

    const tabPrimaryColumn = document.createElement('div');
    userscriptTabDiv.append(tabPrimaryColumn);

    tabPrimaryColumn.classList.add('col-10', 'overflow');

    const asideColumn = document.createElement('aside');
    userscriptTabDiv.append(asideColumn);

    asideColumn.classList.add('col-12', 'overflow', 'col-right', 'js-hide-in-app');

    // Filtered reviews
    const filteredReviewsTitle = document.createElement('h3');
    asideColumn.append(filteredReviewsTitle);

    filteredReviewsTitle.classList.add('title-3');
    filteredReviewsTitle.style.cssText = 'margin-top: 0em;';
    filteredReviewsTitle.innerText = 'Filtered Reviews';

    const filteredReviewsUnorderedList = document.createElement('ul');
    asideColumn.append(filteredReviewsUnorderedList);

    filteredReviewsUnorderedList.classList.add('options-list', '-toggle-list', 'js-toggle-list');

    const fieldName = 'spoilers';
    const reviewFilter = getFilter('reviewFilter');
    const checked = reviewFilter[fieldName] || false;

    const spoilerListItem = buildListItemToggle(
      'Filter reviews that contain spoilers',
      checked,
      'reviewFilter',
      fieldName,
    );

    filteredReviewsUnorderedList.appendChild(spoilerListItem);

    let reviewColumnsDiv = document.createElement('div');
    asideColumn.appendChild(reviewColumnsDiv);

    reviewColumnsDiv.classList.add('form-columns', '-cols2');

    const reviewBehaviorsMetadata = {
      fade: {
        fieldName: 'reviewBehaviorFadeAmount',
      },
      blur: {
        fieldName: 'reviewBehaviorBlurAmount',
      },
      replace: {
        fieldName: 'reviewBehaviorReplaceValue',
        labelText: 'Text',
      },
      custom: {
        fieldName: 'reviewBehaviorCustomValue',
      },
    };
    const reviewFormRows = buildBehaviorFormRows(
      reviewColumnsDiv,
      'review',
      REVIEW_BEHAVIORS,
      reviewBehaviorsMetadata,
    );

    // Filtered films
    const favoriteFilmsDiv = document.querySelector(SELECTORS.settings.favoriteFilms);
    const filteredFilmsDiv = favoriteFilmsDiv.cloneNode(true);
    tabPrimaryColumn.appendChild(filteredFilmsDiv);

    const posterList = filteredFilmsDiv.querySelector(SELECTORS.settings.posterList);
    posterList.remove();

    filteredFilmsDiv.querySelector(SELECTORS.settings.subtitle).innerText = 'Filtered Films';
    filteredFilmsDiv.querySelector(SELECTORS.settings.note).innerText =
      'Right click to mark for removal.';

    let hiddenTitlesDiv = document.createElement('div');
    filteredFilmsDiv.append(hiddenTitlesDiv);

    const hiddenTitlesParagraph = document.createElement('p');
    hiddenTitlesDiv.appendChild(hiddenTitlesParagraph);

    hiddenTitlesDiv.classList.add('text-sluglist');

    const filmFilter = getFilter('filmFilter');
    log(VERBOSE, 'filmFilter', filmFilter);

    filmFilter.forEach(hiddenTitle => {
      log(VERBOSE, 'hiddenTitle', hiddenTitle);

      let filteredTitleLink = document.createElement('a');
      hiddenTitlesParagraph.appendChild(filteredTitleLink);

      filteredTitleLink.href= `/film/${hiddenTitle.slug}`;

      filteredTitleLink.classList.add(
        'text-slug',
        SELECTORS.processedClass.apply,
        SELECTORS.settings.filteredTitleLinkClass,
      );
      filteredTitleLink.setAttribute('data-film-id', hiddenTitle.id);
      filteredTitleLink.innerText = `${hiddenTitle.name} (${hiddenTitle.year})`;

      filteredTitleLink.oncontextmenu = (event) => {
        event.preventDefault();

        filteredTitleLink.classList.toggle(SELECTORS.settings.removePendingClass);
      };
    });

    let formColumnsDiv = document.createElement('div');
    filteredFilmsDiv.appendChild(formColumnsDiv);

    formColumnsDiv.classList.add('form-columns', '-cols2');

    // Filtered Films Behavior
    const filmBehaviorsMetadata = {
      fade: {
        fieldName: 'filmBehaviorFadeAmount',
      },
      blur: {
        fieldName: 'filmBehaviorBlurAmount',
      },
      replace: {
        fieldName: 'filmBehaviorReplaceValue',
        labelText: 'URL',
      },
      custom: {
        fieldName: 'filmBehaviorCustomValue',
      },
    };
    const filmFormRows = buildBehaviorFormRows(
      formColumnsDiv,
      'film',
      FILM_BEHAVIORS,
      filmBehaviorsMetadata,
    );

    const clearDiv = filteredFilmsDiv.querySelector(SELECTORS.settings.clear);
    clearDiv.remove();

    let buttonsRowDiv = document.createElement('div');
    userscriptTabDiv.appendChild(buttonsRowDiv);

    buttonsRowDiv.style.cssText = 'display: flex; align-items: center;';
    buttonsRowDiv.classList.add('buttons', 'clear', 'row');

    let saveInput = document.createElement('input');
    buttonsRowDiv.appendChild(saveInput);

    saveInput.classList.add('button', 'button-action');
    saveInput.setAttribute('value', 'Save Changes');
    saveInput.setAttribute('type', 'submit');
    saveInput.onclick = (event) => {
      event.preventDefault();

      const pendingRemovals = hiddenTitlesParagraph.querySelectorAll(`.${SELECTORS.settings.removePendingClass}`);
      pendingRemovals.forEach(removalLink => {
        const id = parseInt(removalLink.getAttribute('data-film-id'));
        const hiddenTitle = filmFilter.find(hiddenTitle => hiddenTitle.id === id);

        removeTitle(hiddenTitle);
        removeFromFilterTitles(hiddenTitle);
        removalLink.remove();
      });

      saveBehaviorSettings('film', filmFormRows);
      saveBehaviorSettings('review', reviewFormRows);

      const inputToggles = userscriptTabDiv.querySelectorAll('input[type="checkbox"]');
      inputToggles.forEach(inputToggle => {
        const filterName = inputToggle.getAttribute('data-filter-name');
        const filter = getFilter(filterName);

        const fieldName = inputToggle.getAttribute('data-field-name');
        const checked = inputToggle.checked;

        filter[fieldName] = checked;
        setFilter(filterName, filter);
      });

      displaySavedBadge();
    };

    let checkContainerDiv = document.createElement('div');
    buttonsRowDiv.appendChild(checkContainerDiv);

    checkContainerDiv.classList.add('check-container');
    checkContainerDiv.style.cssText = 'margin-left: 10px;';

    let usernameAvailableParagraph = document.createElement('p');
    checkContainerDiv.appendChild(usernameAvailableParagraph);

    usernameAvailableParagraph.classList.add(
      'username-available',
      'has-icon',
      'hidden',
      SELECTORS.settings.savedBadgeClass,
    );
    usernameAvailableParagraph.style.cssText = 'float: left;';

    let iconSpan = document.createElement('span');
    usernameAvailableParagraph.appendChild(iconSpan);

    iconSpan.classList.add('icon');

    const savedText = document.createTextNode('Saved');
    usernameAvailableParagraph.appendChild(savedText);

    const settingsSubNav = document.querySelector(SELECTORS.settings.subNav);

    const userscriptSubNabListItem = document.createElement('li');
    settingsSubNav.appendChild(userscriptSubNabListItem);

    const userscriptSubNabLink = document.createElement('a');
    userscriptSubNabListItem.appendChild(userscriptSubNabLink);

    const userscriptSettingsLink = '/settings/?filterboxd';
    userscriptSubNabLink.setAttribute('href', userscriptSettingsLink);
    userscriptSubNabLink.setAttribute('data-id', 'filterboxd');
    userscriptSubNabLink.innerText = 'Filterboxd';
    userscriptSubNabLink.onclick = (event) => {
      event.preventDefault();

      Array.from(settingsSubNav.children).forEach(listItem => {
        const link = listItem.querySelector('a');

        if (link.getAttribute('data-id') === 'filterboxd') {
          listItem.classList.add('selected');
        } else {
          listItem.classList.remove('selected');
        }
      });

      Array.from(settingsTabbedContent.children).forEach(tab => {
        if (!tab.id) return;

        const display = tab.id === userscriptTabId ? 'block' : 'none';
        tab.style.cssText = `display: ${display};`;
      });

      window.history.replaceState(null, '', `https://letterboxd.com${userscriptSettingsLink}`);
    };

    Array.from(settingsSubNav.children).forEach(listItem => {
      listItem.onclick = (event) => {
        const link = event.target;
        if (link.getAttribute('href') === userscriptSettingsLink) return;

        userscriptSubNabListItem.classList.remove('selected');
        userscriptTabDiv.style.display = 'none';
      };
    });

    const urlParams = new URLSearchParams(window.location.search);
    const tabSelected = urlParams.get('filterboxd') !== null;
    log(VERBOSE, 'tabSelected', tabSelected);

    // TODO: Fix unreliability
    if (tabSelected) window.onload = () => userscriptSubNabLink.click();
  }

  function maybeAddListItemToSidebar() {
    log(DEBUG, 'maybeAddListItemToSidebar()');

    if (document.querySelector(createId(SELECTORS.userpanel.userscriptListItemId))) return;

    const userpanel = document.querySelector(SELECTORS.userpanel.self);

    if (!userpanel) {
      log(INFO, 'Userpanel not found');
      return;
    }

    const secondLastListItem = userpanel.querySelector('li:nth-last-child(2)');
    if (!secondLastListItem ) {
      log(INFO, 'Second last list item not found');
      return;
    }

    let userscriptListItem = secondLastListItem.cloneNode(true);
    userscriptListItem.setAttribute('id', SELECTORS.userpanel.userscriptListItemId);

    const addToListLink = secondLastListItem.firstElementChild;
    const addThisFilmLink = userpanel.querySelector(SELECTORS.userpanel.addThisFilm);

    userscriptListItem = buildUserscriptLink(userscriptListItem, addToListLink, addThisFilmLink);

    secondLastListItem.parentNode.insertBefore(userscriptListItem, userpanel.querySelector('li:nth-last-of-type(1)'));
  }

  function removeFilterFromElement(element, levelsUp = 0) {
    log(DEBUG, 'removeFilterFromElement()');

    const replaceBehavior = GMC.get('filmBehaviorType') === 'Replace poster';
    log(VERBOSE, 'replaceBehavior', replaceBehavior);

    if (replaceBehavior) {
      const originalImgSrc = element.getAttribute('data-original-img-src');
      if (!originalImgSrc) return;

      element.querySelector('img').src = originalImgSrc;
      element.querySelector('img').srcset = originalImgSrc;

      element.removeAttribute('data-original-img-src');
      element.classList.add(SELECTORS.processedClass.remove);
    } else {
      let target = element;

      for (let i = 0; i < levelsUp; i++) {
        if (target.parentNode) {
          target = target.parentNode;
        } else {
          break;
        }
      }

      log(VERBOSE, 'target', target);

      target.classList.remove(SELECTORS.filterTitleClass);
      element.classList.add(SELECTORS.processedClass.remove);
    }
  }

  function removeFromFilterTitles(titleMetadata) {
    let filmFilter = getFilter('filmFilter');
    filmFilter = filmFilter.filter(hiddenTitle => hiddenTitle.id !== titleMetadata.id);

    setFilter('filmFilter', filmFilter);
  }

  function removeTitle({ id, slug }) {
    log(DEBUG, 'removeTitle()');

    const idMatch = `[data-film-id="${id}"]`;
    let removedSelector = `.${SELECTORS.processedClass.remove}`;

    // Activity page reviews
    document.querySelectorAll(`section.activity-row ${idMatch}`).forEach(posterElement => {
      removeFilterFromElement(posterElement, 3);
    });

    // Activity page likes
    document.querySelectorAll(`section.activity-row .activity-summary a[href*="${slug}"]:not(${removedSelector})`).forEach(posterElement => {
      removeFilterFromElement(posterElement, 3);
    });

    // debugger;
    // New from friends
    document.querySelectorAll(`.poster-container ${idMatch}:not(${removedSelector})`).forEach(posterElement => {
      removeFilterFromElement(posterElement, 1);
    });

    // Reviews
    document.querySelectorAll(`.review-tile ${idMatch}:not(${removedSelector})`).forEach(posterElement => {
      removeFilterFromElement(posterElement, 3);
    });

    // Diary
    document.querySelectorAll(`.td-film-details [data-original-img-src]${idMatch}:not(${removedSelector})`).forEach(posterElement => {
      removeFilterFromElement(posterElement, 2);
    });

    // Popular with friends, competitions
    const remainingElements = document.querySelectorAll(
      `div:not(.popmenu):not(.actions-panel) ${idMatch}:not(aside [data-film-id="${id}"]):not(${removedSelector})`,
    );
    remainingElements.forEach(posterElement => {
      removeFilterFromElement(posterElement, 0);
    });
  }

  function saveBehaviorSettings(filterType, formRows) {
    const behaviorType = formRows[0].querySelector('select').value;
    log(DEBUG, 'behaviorType', behaviorType);

    GMC.set(`${filterType}BehaviorType`, behaviorType);

    updateBehaviorCSSVariables(filterType, behaviorType);

    if (behaviorType === 'Fade') {
      const behaviorFadeAmount = formRows[1].querySelector('select').value;
      log(DEBUG, 'behaviorFadeAmount', behaviorFadeAmount);

      GMC.set(`${filterType}BehaviorFadeAmount`, behaviorFadeAmount);
    } else if (behaviorType === 'Blur') {
      const behaviorBlurAmount = formRows[2].querySelector('select').value;
      log(DEBUG, 'behaviorBlurAmount', behaviorBlurAmount);

      GMC.set(`${filterType}BehaviorBlurAmount`, behaviorBlurAmount);
    } else if (behaviorType.includes('Replace')) {
      const behaviorReplaceValue = formRows[3].querySelector('input').value;
      log(DEBUG, 'behaviorReplaceValue', behaviorReplaceValue);

      GMC.set(`${filterType}BehaviorReplaceValue`, behaviorReplaceValue);
    } else if (behaviorType === 'Custom') {
      const behaviorCustomValue = formRows[4].querySelector('input').value;
      log(DEBUG, 'behaviorCustomValue', behaviorCustomValue);

      GMC.set(`${filterType}BehaviorCustomValue`, behaviorCustomValue);
    }

    GMC.save();
  }

  function setFilter(filterName, filterValue) {
    GMC.set(filterName, JSON.stringify(filterValue));
    return GMC.save();
  }

  function updateBehaviorCSSVariables(filterType, behaviorType) {
    log(DEBUG, 'updateBehaviorTypeVariable()');

    const fadeValue = behaviorType === 'Fade' ? 'block' : 'none';
    document.documentElement.style.setProperty(
      `--filterboxd-${filterType}-behavior-fade`,
      fadeValue,
    );

    const blurValue = behaviorType === 'Blur' ? 'block' : 'none';
    document.documentElement.style.setProperty(
      `--filterboxd-${filterType}-behavior-blur`,
      blurValue,
    );

    const replaceValue = behaviorType.includes('Replace') ? 'block' : 'none';
    document.documentElement.style.setProperty(
      `--filterboxd-${filterType}-behavior-replace`,
      replaceValue,
    );

    const customValue = behaviorType === 'Custom' ? 'block' : 'none';
    document.documentElement.style.setProperty(
      `--filterboxd-${filterType}-behavior-custom`,
      customValue,
    );
  }

  function updateLinkInPopMenu(titleIsHidden, link) {
    log(DEBUG, 'updateLinkInPopMenu()');

    link.setAttribute('data-title-hidden', titleIsHidden);

    const innerText = titleIsHidden ? 'Remove from filter' : 'Add to filter';
    link.innerText = innerText;
  }

  let OBSERVER = new MutationObserver(observeAndModify);

  let GMC = new GM_config({
    id: 'gmc-frame',
    events: {
      init: gmcInitialized,
    },
    fields: {
      filmBehaviorType: {
        type: 'select',
        options: FILM_BEHAVIORS,
        default: 'Fade',
      },
      filmBehaviorBlurAmount: {
        type: 'int',
        default: 3,
      },
      filmBehaviorCustomValue: {
        type: 'text',
        default: '',
      },
      filmBehaviorFadeAmount: {
        type: 'int',
        default: 10,
      },
      filmBehaviorReplaceValue: {
        type: 'text',
        default: 'https://a.ltrbxd.com/resized/film-poster/4/8/7/9/1/48791-bee-movie-0-230-0-345-crop.jpg?v=2b9ece5cba',
      },
      filmFilter: {
        type: 'text',
        default: JSON.stringify([]),
      },
      logLevel: {
        type: 'select',
        options: [
          'silent',
          'quiet',
          'debug',
          'verbose',
          'trace',
        ],
        default: 'quiet',
      },
      reviewBehaviorType: {
        type: 'select',
        options: REVIEW_BEHAVIORS,
        default: 'Fade',
      },
      reviewBehaviorBlurAmount: {
        type: 'int',
        default: 3,
      },
      reviewBehaviorCustomValue: {
        type: 'text',
        default: '',
      },
      reviewBehaviorFadeAmount: {
        type: 'int',
        default: 10,
      },
      reviewBehaviorReplaceValue: {
        type: 'text',
        default: 'According to all known laws of aviation, there is no way a bee should be able to fly.',
      },
      reviewFilter: {
        type: 'text',
        default: JSON.stringify({}),
      },
    },
  });
})();
