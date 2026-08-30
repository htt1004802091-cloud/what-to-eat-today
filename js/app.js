"use strict";

const views = [...document.querySelectorAll("[data-view]")];
const entryButtons = [...document.querySelectorAll("[data-mode]")];
const backButtons = [...document.querySelectorAll('[data-action="back"]')];
const changeTakeoutButton = document.querySelector('[data-action="change-takeout"]');
const changeRecipeButton = document.querySelector('[data-action="change-recipe"]');
const openRecipeDetailButton = document.querySelector('[data-action="open-recipe-detail"]');
const backToRecipeButton = document.querySelector('[data-action="back-to-recipe"]');
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const CANDIDATE_POOL_SIZE = 2;
const CANDIDATE_PRELOAD_ATTEMPT_LIMIT = 3;
const SLOW_IMAGE_THRESHOLD = 3000;

let takeoutItems = [];
let recipeItems = [];
let currentTakeoutName = null;
let currentRecipeName = null;
let currentRecipeItem = null;
let takeoutRequestToken = 0;
let recipeRequestToken = 0;
let takeoutLoading = false;
let recipeLoading = false;
let recipeTitleLayoutFrame = 0;
let activeMode = null;
let dataReady = false;
let dataLoadPromise = null;
let backgroundPreloadRunning = false;
let backgroundCandidate = null;
let candidateFillTimer = 0;

const imageLoadStates = new Map();
const candidatePools = {
  takeout: [],
  recipe: [],
};
const candidatePoolGenerations = {
  takeout: 0,
  recipe: 0,
};
const candidatePreloadPaused = {
  takeout: false,
  recipe: false,
};

function showView(viewName) {
  views.forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });

  if (viewName === "home") {
    document.title = "今天吃什么";
    document.querySelector("#page-title").focus({ preventScroll: true });
    return;
  }

  if (viewName === "recipe" || viewName === "recipe-detail") {
    window.scrollTo(0, 0);
  }

  const title = document.querySelector(`#${viewName}-view-title`);
  document.title = `${title.textContent}｜今天吃什么`;
  title.focus({ preventScroll: true });

  if (viewName === "recipe-detail") {
    scheduleRecipeDetailTitleLayout();
  }
}

function getRandomItem(items, currentName) {
  if (items.length === 0) {
    return null;
  }

  const choices = items.length > 1
    ? items.filter((item) => item.name !== currentName)
    : items;

  return choices[Math.floor(Math.random() * choices.length)];
}

function renderTakeout(item, imageUrl) {
  currentTakeoutName = item.name;
  document.querySelector("#takeout-name").textContent = item.name;
  document.querySelector("#takeout-category").textContent = item.category;
  updateImage(
    "#takeout-image",
    ".takeout-food-stage",
    item,
    imageUrl,
    "takeout",
  );

  if (imageUrl) {
    hideError("takeout");
  } else {
    showError("takeout", "图片暂时没加载出来，换一个试试吧。");
  }
}

function renderRecipe(item, imageUrl) {
  currentRecipeName = item.name;
  currentRecipeItem = item;
  document.querySelector("#recipe-name").textContent = item.name;
  document.querySelector("#recipe-category").textContent = item.category;
  document.querySelector("#recipe-difficulty").textContent = item.difficulty;
  document.querySelector("#recipe-detail-view-title").textContent = item.name;
  document.querySelector("#recipe-detail-category").textContent = item.category;
  document.querySelector("#recipe-detail-difficulty").textContent = `难度：${item.difficulty}`;
  renderList("#recipe-ingredients", item.ingredients);
  renderList("#recipe-steps", item.steps);
  updateImage(
    "#recipe-image",
    ".recipe-food-stage",
    item,
    imageUrl,
    "recipe",
  );
  updateImage(
    "#recipe-detail-image",
    ".recipe-detail-food-stage",
    item,
    imageUrl,
    "recipe",
  );

  if (imageUrl) {
    hideError("recipe");
  } else {
    showError("recipe", "图片暂时没加载出来，换一个试试吧。");
  }

  scheduleRecipeDetailTitleLayout();
}

function updateImage(imageSelector, stageSelector, item, imageUrl, mode) {
  const image = document.querySelector(imageSelector);
  const stage = document.querySelector(stageSelector);

  image.onerror = null;

  if (!imageUrl) {
    showImageFallback(image, stage, item);
    return;
  }

  stage.classList.remove("is-image-error");
  stage.removeAttribute("role");
  stage.removeAttribute("aria-label");
  delete stage.dataset.imageError;
  image.alt = item.name;
  image.src = imageUrl;
  image.hidden = false;
  image.onerror = () => {
    showImageFallback(image, stage, item);
    showError(mode, "图片暂时没加载出来，换一个试试吧。");
  };
}

function showImageFallback(image, stage, item) {
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute("src");
  image.alt = "";
  stage.classList.add("is-image-error");
  stage.dataset.imageError = "图片暂时走丢啦";
  stage.setAttribute("role", "img");
  stage.setAttribute("aria-label", `${item.name}图片加载失败`);
}

function renderList(selector, items) {
  const list = document.querySelector(selector);
  list.replaceChildren();

  items.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });
}

function showError(mode, message) {
  const status = document.querySelector(`#${mode}-status`);
  status.textContent = message;
  status.hidden = false;
}

function hideError(mode) {
  const status = document.querySelector(`#${mode}-status`);
  status.hidden = true;
}

function animateResult(mode, render) {
  const result = document.querySelector(`[data-result="${mode}"]`);

  if (!result || reducedMotion.matches) {
    render();
    return Promise.resolve(true);
  }

  if (result.classList.contains("is-leaving")) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    result.classList.remove("is-entering");
    result.classList.add("is-leaving");

    window.setTimeout(() => {
      render();
      result.classList.remove("is-leaving");
      result.classList.add("is-entering");

      window.setTimeout(() => {
        result.classList.remove("is-entering");
        resolve(true);
      }, 300);
    }, 140);
  });
}

function setModeLoading(mode, isLoading) {
  const button = mode === "takeout" ? changeTakeoutButton : changeRecipeButton;
  const result = document.querySelector(`[data-result="${mode}"]`);
  const label = button.lastElementChild;

  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  button.classList.toggle("is-loading", isLoading);
  label.textContent = isLoading ? "图片准备中…" : "换一个";
  result.setAttribute("aria-busy", String(isLoading));

  if (mode === "recipe") {
    openRecipeDetailButton.disabled = isLoading;
  }
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function addRetryQuery(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}image-retry=${Date.now()}`;
}

function loadImageOnce(path, { priority = "auto" } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`图片加载超时：${path}`));
    }, 10000);

    image.decoding = "async";
    if ("fetchPriority" in image) {
      image.fetchPriority = priority;
    }
    image.onload = async () => {
      window.clearTimeout(timeout);

      try {
        if (typeof image.decode === "function") {
          await image.decode();
        }

        resolve(path);
      } catch (error) {
        reject(error);
      } finally {
        image.onload = null;
        image.onerror = null;
      }
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      reject(new Error(`图片加载失败：${path}`));
    };
    image.src = path;
  });
}

async function loadImageWithRetry(path, { priority = "auto" } = {}) {
  try {
    return {
      imageUrl: await loadImageOnce(path, { priority }),
      error: null,
    };
  } catch (firstError) {
    await wait(180);

    try {
      return {
        imageUrl: await loadImageOnce(addRetryQuery(path), { priority }),
        error: null,
      };
    } catch (secondError) {
      return { imageUrl: null, error: secondError ?? firstError };
    }
  }
}

function loadImage(path, { priority = "auto" } = {}) {
  const existing = imageLoadStates.get(path);

  if (existing?.status === "ready") {
    return Promise.resolve({
      imageUrl: existing.imageUrl,
      error: null,
      reused: true,
    });
  }

  if (existing?.status === "loading") {
    return existing.promise.then((result) => ({ ...result, reused: true }));
  }

  const promise = loadImageWithRetry(path, { priority }).then((result) => {
    if (result.imageUrl) {
      imageLoadStates.set(path, {
        status: "ready",
        imageUrl: result.imageUrl,
      });
    } else {
      imageLoadStates.delete(path);
    }

    return { ...result, reused: false };
  });

  imageLoadStates.set(path, { status: "loading", promise });
  return promise;
}

function getModeItems(mode) {
  return mode === "takeout" ? takeoutItems : recipeItems;
}

function getModeCurrentName(mode) {
  return mode === "takeout" ? currentTakeoutName : currentRecipeName;
}

function getModeLoading(mode) {
  return mode === "takeout" ? takeoutLoading : recipeLoading;
}

function setActiveMode(mode) {
  if (activeMode === mode) {
    return;
  }

  window.clearTimeout(candidateFillTimer);
  candidateFillTimer = 0;

  if (activeMode) {
    candidatePoolGenerations[activeMode] += 1;
  }

  activeMode = mode;

  if (mode) {
    scheduleCandidateFill(mode);
  }
}

function shouldPauseCandidatePreload(mode) {
  const connection = navigator.connection
    ?? navigator.mozConnection
    ?? navigator.webkitConnection;
  const slowConnection = connection
    && (connection.saveData || ["slow-2g", "2g"].includes(connection.effectiveType));

  return activeMode !== mode
    || document.hidden
    || getModeLoading(mode)
    || candidatePreloadPaused[mode]
    || Boolean(slowConnection);
}

function takeReadyCandidate(mode) {
  const pool = candidatePools[mode];
  const currentName = getModeCurrentName(mode);

  while (pool.length > 0) {
    const candidate = pool.shift();

    if (candidate.item.name !== currentName) {
      return candidate;
    }
  }

  return null;
}

function getForegroundRandomItem(mode) {
  const items = getModeItems(mode);
  const currentName = getModeCurrentName(mode);
  const excludedNames = new Set([
    currentName,
    ...candidatePools[mode].map((candidate) => candidate.item.name),
  ]);

  if (backgroundCandidate?.mode === mode) {
    excludedNames.add(backgroundCandidate.item.name);
  }

  const availableItems = items.filter((item) => !excludedNames.has(item.name));
  return getRandomItem(availableItems.length > 0 ? availableItems : items, currentName);
}

function getCandidateItem(mode, attemptedNames) {
  const currentName = getModeCurrentName(mode);
  const excludedNames = new Set([
    currentName,
    ...attemptedNames,
    ...candidatePools[mode].map((candidate) => candidate.item.name),
  ]);
  const availableItems = getModeItems(mode)
    .filter((item) => !excludedNames.has(item.name));

  return getRandomItem(availableItems, null);
}

function scheduleCandidateFill(mode) {
  window.clearTimeout(candidateFillTimer);
  candidateFillTimer = window.setTimeout(() => {
    candidateFillTimer = 0;
    void fillCandidatePool(mode);
  }, 0);
}

async function fillCandidatePool(mode) {
  if (
    backgroundPreloadRunning
    || shouldPauseCandidatePreload(mode)
    || !getModeCurrentName(mode)
    || candidatePools[mode].length >= CANDIDATE_POOL_SIZE
  ) {
    return false;
  }

  const generation = candidatePoolGenerations[mode];
  const attemptedNames = new Set();
  let attempts = 0;
  let added = 0;

  backgroundPreloadRunning = true;

  try {
    while (
      attempts < CANDIDATE_PRELOAD_ATTEMPT_LIMIT
      && candidatePools[mode].length < CANDIDATE_POOL_SIZE
      && !shouldPauseCandidatePreload(mode)
      && generation === candidatePoolGenerations[mode]
    ) {
      const item = getCandidateItem(mode, attemptedNames);

      if (!item) {
        break;
      }

      attempts += 1;
      attemptedNames.add(item.name);
      backgroundCandidate = { mode, item };

      const startedAt = window.performance.now();
      const { imageUrl } = await loadImage(item.image, { priority: "low" });
      const elapsed = window.performance.now() - startedAt;
      backgroundCandidate = null;

      if (
        activeMode !== mode
        || document.hidden
        || generation !== candidatePoolGenerations[mode]
      ) {
        break;
      }

      if (!imageUrl) {
        if (elapsed >= SLOW_IMAGE_THRESHOLD) {
          candidatePreloadPaused[mode] = true;
          break;
        }

        continue;
      }

      const isCurrent = item.name === getModeCurrentName(mode);
      const isDuplicate = candidatePools[mode]
        .some((candidate) => candidate.item.name === item.name);

      if (!isCurrent && !isDuplicate) {
        candidatePools[mode].push({ item, imageUrl });
        added += 1;
      }

      if (elapsed >= SLOW_IMAGE_THRESHOLD) {
        candidatePreloadPaused[mode] = true;
        break;
      }
    }
  } finally {
    backgroundCandidate = null;
    backgroundPreloadRunning = false;

    if (activeMode && activeMode !== mode) {
      scheduleCandidateFill(activeMode);
    } else if (
      activeMode === mode
      && attempts > 0
      && attempts < CANDIDATE_PRELOAD_ATTEMPT_LIMIT
      && candidatePools[mode].length < CANDIDATE_POOL_SIZE
      && !shouldPauseCandidatePreload(mode)
    ) {
      scheduleCandidateFill(mode);
    }
  }

  return added > 0;
}

async function requestTakeout({ animate = true } = {}) {
  if (takeoutLoading) {
    return false;
  }

  const candidate = takeReadyCandidate("takeout");
  const item = candidate?.item ?? getForegroundRandomItem("takeout");

  if (!item) {
    showError("takeout", "暂时没有可推荐的外卖，请检查数据文件。");
    return false;
  }

  const requestToken = ++takeoutRequestToken;
  takeoutLoading = true;
  setModeLoading("takeout", true);
  hideError("takeout");

  try {
    let imageUrl = candidate?.imageUrl ?? null;

    if (!candidate) {
      const startedAt = window.performance.now();
      const result = await loadImage(item.image, { priority: "high" });
      const elapsed = window.performance.now() - startedAt;
      imageUrl = result.imageUrl;
      candidatePreloadPaused.takeout = !imageUrl || elapsed >= SLOW_IMAGE_THRESHOLD;
    }

    if (requestToken !== takeoutRequestToken) {
      return false;
    }

    const commit = () => renderTakeout(item, imageUrl);

    if (animate && currentTakeoutName !== null) {
      await animateResult("takeout", commit);
    } else {
      commit();
    }

    if (imageUrl && activeMode === "takeout") {
      scheduleCandidateFill("takeout");
    }

    return Boolean(imageUrl);
  } finally {
    if (requestToken === takeoutRequestToken) {
      takeoutLoading = false;
      setModeLoading("takeout", false);
    }
  }
}

async function requestRecipe({ animate = true } = {}) {
  if (recipeLoading) {
    return false;
  }

  const candidate = takeReadyCandidate("recipe");
  const item = candidate?.item ?? getForegroundRandomItem("recipe");

  if (!item) {
    showError("recipe", "暂时没有可推荐的菜谱，请检查数据文件。");
    return false;
  }

  const requestToken = ++recipeRequestToken;
  recipeLoading = true;
  setModeLoading("recipe", true);
  hideError("recipe");

  try {
    let imageUrl = candidate?.imageUrl ?? null;

    if (!candidate) {
      const startedAt = window.performance.now();
      const result = await loadImage(item.image, { priority: "high" });
      const elapsed = window.performance.now() - startedAt;
      imageUrl = result.imageUrl;
      candidatePreloadPaused.recipe = !imageUrl || elapsed >= SLOW_IMAGE_THRESHOLD;
    }

    if (requestToken !== recipeRequestToken) {
      return false;
    }

    const commit = () => renderRecipe(item, imageUrl);

    if (animate && currentRecipeName !== null) {
      await animateResult("recipe", commit);
    } else {
      commit();
    }

    if (imageUrl && activeMode === "recipe") {
      scheduleCandidateFill("recipe");
    }

    return Boolean(imageUrl);
  } finally {
    if (requestToken === recipeRequestToken) {
      recipeLoading = false;
      setModeLoading("recipe", false);
    }
  }
}

function scheduleRecipeDetailTitleLayout() {
  window.cancelAnimationFrame(recipeTitleLayoutFrame);
  recipeTitleLayoutFrame = window.requestAnimationFrame(() => {
    const detailView = document.querySelector('[data-view="recipe-detail"]');
    const title = document.querySelector("#recipe-detail-view-title");
    const collage = document.querySelector(".recipe-detail-collage");

    if (detailView.hidden || !title || !collage) {
      return;
    }

    const lineHeight = Number.parseFloat(window.getComputedStyle(title).lineHeight);
    const hasMultipleLines = Number.isFinite(lineHeight)
      && title.scrollHeight > lineHeight * 1.5;
    collage.classList.toggle("has-multiline-title", hasMultipleLines);
  });
}

async function fetchJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`无法读取 ${path}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new TypeError(`${path} 的内容必须是数组`);
  }

  return data;
}

async function loadData() {
  try {
    [takeoutItems, recipeItems] = await Promise.all([
      fetchJson("data/takeout.json"),
      fetchJson("data/recipe.json"),
    ]);
    dataReady = true;
    return true;
  } catch (error) {
    dataReady = false;
    console.error(error);
    showError("takeout", "数据读取失败，请通过本地服务器打开网站。");
    showError("recipe", "数据读取失败，请通过本地服务器打开网站。");
    return false;
  }
}

async function enterMode(mode) {
  setActiveMode(mode);
  showView(mode);

  if (!dataReady) {
    setModeLoading(mode, true);
    const loaded = await dataLoadPromise;
    setModeLoading(mode, false);

    if (!loaded || activeMode !== mode) {
      return;
    }
  }

  if (!getModeCurrentName(mode)) {
    if (mode === "takeout") {
      await requestTakeout({ animate: false });
    } else {
      await requestRecipe({ animate: false });
    }
    return;
  }

  scheduleCandidateFill(mode);
}

entryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    void enterMode(mode);
  });
});

backButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveMode(null);
    showView("home");
  });
});

changeTakeoutButton.addEventListener("click", () => void requestTakeout());
changeRecipeButton.addEventListener("click", () => void requestRecipe());
openRecipeDetailButton.addEventListener("click", () => {
  if (currentRecipeItem) {
    showView("recipe-detail");
  }
});
backToRecipeButton.addEventListener("click", () => showView("recipe"));
window.addEventListener("resize", scheduleRecipeDetailTitleLayout);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(candidateFillTimer);
    candidateFillTimer = 0;

    if (activeMode) {
      candidatePoolGenerations[activeMode] += 1;
    }
    return;
  }

  if (activeMode) {
    scheduleCandidateFill(activeMode);
  }
});
window.addEventListener("pagehide", () => {
  window.clearTimeout(candidateFillTimer);
  candidateFillTimer = 0;
  candidatePoolGenerations.takeout += 1;
  candidatePoolGenerations.recipe += 1;
});
window.addEventListener("pageshow", () => {
  if (activeMode) {
    scheduleCandidateFill(activeMode);
  }
});

dataLoadPromise = loadData();
