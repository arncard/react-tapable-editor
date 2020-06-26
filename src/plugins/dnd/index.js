import Sabar from "sabar";
import Container from "./Container";
import Dragger from "./Dragger";
import { isElement } from "./dom";
import { findClosestContainer } from "./find";
import resolveDndConfig from "./configs/resolveDndConfig";
import resolveConfig from "./configs/resolveConfig";
import { setContainerAttributes, setDraggerAttributes } from "./setAttributes";
import mutationHandler from "./mutationHandler";

import getDimensions from "./middleware/onStart/getDimensions";
import getDimensionsNested from "./middleware/onStart/getDimensionsNested";
import validateContainers from "./middleware/onStart/validateContainers";
import attemptToCreateClone from "./middleware/onStart/attemptToCreateClone";

import syncCopyPosition from "./middleware/onMove/syncCopyPosition";
import handleLeaveContainer from "./middleware/onMove/effects/handleLeaveContainer";
import handleEnterContainer from "./middleware/onMove/effects/handleEnterContainer";
import handleEnterHomeContainer from "./middleware/onMove/effects/handleEnterHomeContainer";
import handleEnterOtherContainer from "./middleware/onMove/effects/handleEnterOtherContainer";
import handleImpactDraggerEffectOnEnter from "./middleware/onMove/effects/handleImpactDraggerEffectOnEnter";
import handleReorder from "./middleware/onMove/effects/handleReorder";
import handleReorderOnHomeContainer from "./middleware/onMove/effects/handleReorderOnHomeContainer";
import handleReorderOnOtherContainer from "./middleware/onMove/effects/handleReorderOnOtherContainer";
import handleImpactDraggerEffectOnReorder from "./middleware/onMove/effects/handleImpactDraggerEffectOnReorder";
// import movingOnHomeContainer from "./middleware/onMove/movingOnHomeContainer";
// import resolvePlacedInfo from "./middleware/onMove/resolvePlacedInfo";
// import updateEffects from "./middleware/onMove/updateEffects";

import getImpactRawInfo from "./middleware/shared/getImpactRawInfo";
import resolveRawPlacedInfo from "./middleware/shared/resolveRawPlacedInfo";
import resolveNestedRawPlaceInfo from "./middleware/shared/resolveNestedRawPlaceInfo";
import getDropTarget from "./middleware/shared/getContainer";
import { SyncHook } from "tapable";
import closest from "./closest";

import MouseSensor from "./sensors/mouse";
import reporter from "./reporter";
import DndEffects from "./middleware/onMove/effects/DndEffects";
// import ContainersEffects from "./ContainersEffects";

class DND {
  constructor({ configs = [], rootElement, ...rest }) {
    this.containers = {};
    this.draggers = {};
    this.extra = {};
    this.effects = {
      containers: [],
      draggers: [],
      containerEffects: [],
      draggerEffects: []
    };

    // this.containersEffects = new ContainersEffects();
    this.dndEffects = new DndEffects();

    this.configs = resolveConfig(configs, rest);

    // global config to control all of the containers...
    this.dndConfig = resolveDndConfig(rest);

    this.containerEffects = [];
    this.draggerEffects = [];

    this.hooks = {
      syncEffects: new SyncHook(["values"]),
      cleanupEffects: new SyncHook()
    };
    this.rootElement = rootElement;

    this.startObserve();
    this.setUp();

    this.onStartHandler = new Sabar({
      ctx: {
        containers: this.containers,
        draggers: this.draggers,
        vDraggers: this.draggers,
        vContainers: this.containers,
        extra: this.extra,
        hooks: this.hooks,
        dndConfig: this.dndConfig,
        containersEffects: this.containersEffects,
        impact: {},
        dndEffects: new DndEffects()
      }
    });

    this.onMoveHandler = new Sabar({
      ctx: {
        containers: this.containers,
        draggers: this.draggers,
        vDraggers: this.draggers,
        vContainers: this.containers,
        effects: this.effects,
        hooks: this.hooks,
        dndConfig: this.dndConfig,
        containersEffects: this.containersEffects,
        prevImpact: {},
        dndEffects: this.dndEffects,
        impact: {} // has placeholder or not...
      }
    });

    this.onStartHandler.use(
      getDimensions,
      getDimensionsNested,
      validateContainers,
      resolveRawPlacedInfo,
      attemptToCreateClone
    );
    this.onMoveHandler.use(
      syncCopyPosition,
      getImpactRawInfo,
      handleLeaveContainer,
      handleEnterContainer,
      handleEnterHomeContainer,
      handleEnterOtherContainer,
      handleImpactDraggerEffectOnEnter,
      handleReorder,
      handleReorderOnHomeContainer,
      handleReorderOnOtherContainer,
      handleImpactDraggerEffectOnReorder,
      // First, find the target container with smallest scope...
      // getDropTarget,
      // movingOnHomeContainer,
      // // resolveRawPlacedInfo,
      // resolveNestedRawPlaceInfo,
      // resolvePlacedInfo,
      // updateEffects,
      (_, ctx) => {
        // console.log("ctx ", ctx);
      }
    );

    this.hooks.syncEffects.tap("syncEffects", values => {
      this.effects = values.effects;
    });
    this.hooks.cleanupEffects.tap("cleanupEffects", () => {
      const { containerEffects, draggerEffects } = this.effects;
      containerEffects.forEach(({ container, teardown }) => {
        reporter.logRemoveEffect(container);
        teardown();
      });
      draggerEffects.forEach(({ dragger, teardown }) => {
        reporter.logRemoveEffect(dragger);
        teardown();
      });
    });

    this.initSensor();
  }

  moveAPI = () => {
    return {
      prevEffects: this.effects,
      hooks: this.hooks
    };
  };

  getClone = () => {
    return this.extra.clone;
  };

  initSensor() {
    this.sensor = new MouseSensor({
      moveAPI: this.moveAPI,
      getClone: this.getClone,
      onStartHandler: this.onStartHandler,
      onMoveHandler: this.onMoveHandler,
      getDragger: this.getDragger,
      getContainer: this.getContainer,
      configs: this.configs
    });
    this.sensor.start();
  }

  getDragger = draggerId => {
    return this.draggers[draggerId];
  };

  getContainer = containerId => {
    return this.containers[containerId];
  };

  startObserve() {
    let rootElement = this.rootElement;

    if (!isElement(rootElement)) {
      const el = document.querySelector(this.rootElement);
      if (el) rootElement = el;
    }

    const observer = new MutationObserver(mutationHandler(this));

    observer.observe(rootElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * extract `containerSelectors` and onStartHandler `container` and `dragger`
   */
  setUp() {
    this.handleContainers();
    this.handleDraggers();
  }

  handleContainers(node = document) {
    this.configs.map(config => {
      const { containerSelector } = config;
      const elements = node.querySelectorAll(containerSelector);
      if (!elements) return;

      elements.forEach(el =>
        this.handleContainerElement(el, config, this.configs)
      );
    });
  }

  handleContainerElement(el, config, dndConfig) {
    const container = new Container({
      el,
      containers: this.containers,
      containerConfig: config,
      dndConfig
    });
    const parentContainerNode = closest(el, '[data-is-container="true"]');
    if (parentContainerNode) {
      const containerId = parentContainerNode.getAttribute("data-container-id");
      const parentContainer = this.containers[containerId];
      container.parentContainer = parentContainer;
    }
    setContainerAttributes(container, config);
  }

  handleDraggers(containerNode = document) {
    this.configs.forEach(config => {
      const { draggerSelector } = config;
      this.handleDraggerInContainer(containerNode, draggerSelector);
    });
  }

  handleDraggerInContainer(containerNode, draggerSelector) {
    const elements = containerNode.querySelectorAll(draggerSelector);
    if (!elements) return;
    elements.forEach(el => this.handleDraggerElement(el));
  }

  /**
   *
   * @param {HTMLElement} el
   * 1. Find closest container node first.
   * 2. Update container's children
   * 3. set dragger element's attributes.
   *
   */
  handleDraggerElement(el) {
    const container = findClosestContainer(this.containers, el, true);
    if (container === -1) return;
    const dragger = new Dragger({ el, container });
    container.addDirectChild(dragger);
    const draggerId = dragger.id;
    this.draggers[draggerId] = dragger;
    setDraggerAttributes(container, dragger);
  }
}

export default DND;
