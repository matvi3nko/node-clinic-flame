'use strict'

// d3-fg is likely a temporary dep, most layout logic will move to analysis and
// most draw / interactivity logic will be replaced here
const d3Fg = require('d3-fg')
const HtmlContent = require('./html-content.js')

const FgTooltipContainer = require('./flame-graph-tooltip-container')
const getLabelRenderer = require('./flame-graph-label.js')
const getFrameRenderer = require('./flame-graph-frame.js')

const searchHighlightColor = 'orange'

class FlameGraph extends HtmlContent {
  constructor (parentContent, contentProperties = {}) {
    const defaults = {
      showOptimizationStatus: false,
      labelFont: 'Verdana, sans-serif',
      labelPadding: 3
    }
    contentProperties = Object.assign({}, defaults, contentProperties)
    super(parentContent, contentProperties)

    this.zoomFactor = contentProperties.zoomFactor
    this.zoomFactorChanged = true

    this.hoveredNodeData = null
    this.isAnimating = false
    this.baseCellHeight = this.ui.presentationMode ? 26 : 20
    this.cellHeight = this.baseCellHeight + this.zoomFactor
    this.sizeChanged = false

    this.tooltip = contentProperties.customTooltip
    this.tooltipHtmlContent = contentProperties.tooltipHtmlContent
    this.showOptimizationStatus = contentProperties.showOptimizationStatus

    this.labelFont = contentProperties.labelFont
    this.labelPadding = contentProperties.labelPadding

    this.onNextAnimationEnd = null

    this.ui.on('setData', () => {
      this.initializeFromData()
    })

    this.ui.on('zoomNode', (node, cb) => {
      if (this.flameGraph) {
        if (cb) this.onNextAnimationEnd = cb

        this.isAnimating = true
        this.zoomedNodeData = node

        // Hide tooltip and highlight box / pointer until .on('animationEnd')
        this.tooltip.hide()
        this.hoveredNodeData = null
        this.highlightHoveredNodeOnGraph()
        this.markNodeAsSelected(null)
        this.markNodeAsZoomed(null)
        this.flameGraph.zoom(node || this.ui.dataTree.activeTree())
      } else {
        if (cb) cb()
      }
    })

    this.ui.on('updateExclusions', () => {
      this.sort()
    })

    this.ui.on('clearSearch', () => {
      this.flameGraph.clear(searchHighlightColor)
    })

    this.ui.on('search', (query) => {
      this.flameGraph.search(query, searchHighlightColor)
    })
  }

  initializeElements () {
    super.initializeElements()
    this.d3Chart = this.d3Element.append('chart')
      .classed('flamegraph-outer', true)
      .classed('scroll-container', true)
      .style('position', 'relative')

    // creating the component to highlight the hovered node on the flame graph
    this.d3Highlighter = this.d3Element.append('div')
      .classed('node-highlighter', true)
    this.d3HighlighterDownArrow = this.d3Highlighter.append('div')
      .classed('down-arrow', true)
    this.d3HighlighterVerticalLine = this.d3Highlighter.append('div')
      .classed('vertical-line', true)
    this.d3HighlighterBox = this.d3Element.append('div')
      .classed('highlighter-box', true)

    this.d3SelectionMarker = this.d3Element.append('div')
      .classed('selection-box', true)

    this.d3ZoomMarker = this.d3Element.append('div')
      .classed('zoom-underline', true)
      .classed('hidden', true)

    if (this.tooltip) {
      this.tooltip = new FgTooltipContainer({
        tooltip: this.tooltip,
        tooltipHtmlContent: this.tooltipHtmlContent
      })
    }

    this.ui.on('highlightNode', node => {
      this.hoveredNodeData = node || this.ui.selectedNode
      this.highlightHoveredNodeOnGraph()
    })

    this.ui.on('selectNode', node => {
      this.hoveredNodeData = node
      this.highlightHoveredNodeOnGraph()

      this.markNodeAsSelected(node)
    })

    // hiding the tooltip on scroll and moving the box
    this.d3Chart.node().addEventListener('scroll', () => {
      this.tooltip.hide({ delay: 0 })
      this.updateMarkerBoxes()
    })
  }

  initializeFromData () {
    const { dataTree } = this.ui

    this.renderedTree = dataTree.activeTree()
    this.flameGraph = d3Fg({
      tree: dataTree.activeTree(),
      exclude: dataTree.exclude,
      isNodeExcluded: node => {
        return this.ui.dataTree.isNodeExcluded(node.data)
      },
      element: this.d3Chart.node(),
      cellHeight: this.cellHeight,
      collapseHiddenNodeWidths: true,
      minHeight: window.screen.availHeight,
      frameColors: {
        fill: '#000',
        stroke: '#363b4c'
      },
      // We already categorized nodes during analysis
      categorizer: (node) => ({ type: node.type }),
      width: this.d3Element.node().clientWidth,
      height: undefined, // we need to improve the way the canvas height gets calculated in d3-fg
      renderTooltip: this.tooltip && null, // disabling the built-in tooltip if another tooltip is defined
      colorHash: (stackTop, { d, decimalAdjust, allSamples, tiers }) => {
        return this.ui.dataTree.getHeatColor(d)
      },
      clickHandler: null,
      renderLabel: getLabelRenderer(this),
      renderStackFrameBox: getFrameRenderer(this)
    })

    this.sort()

    const wrapperNode = this.d3Chart.node()
    this.flameGraph.on('dblClick', (nodeData) => {
      this.ui.zoomNode(nodeData)
    })

    this.flameGraph.on('click', (nodeData, rect, pointerCoords) => {
      if (nodeData) {
        // Treat root node as a zoom out button
        if (nodeData.id === 0) {
          if (this.ui.zoomedNode) this.ui.zoomNode(null)
          return
        }

        // Show (and hide) tooltip instantly on click, no waiting for timeouts
        if (this.tooltip) {
          this.tooltip.show({
            nodeData,
            rect,
            pointerCoords,
            frameIsZoomed: this.zoomedNodeData === nodeData,
            wrapperNode,
            delay: 0
          })
        }

        this.ui.selectNode(nodeData)
      } else {
        if (this.tooltip) this.tooltip.hide({ delay: 0 })

        this.ui.zoomNode(null)
      }
    })

    this.flameGraph.on('hoverin', (nodeData, rect, pointerCoords) => {
      if (nodeData.id === 0) return

      this.hoveredNodeData = nodeData
      this.ui.highlightNode(nodeData)

      if (this.tooltip) {
        this.tooltip.show({
          nodeData,
          rect,
          pointerCoords,
          frameIsZoomed: this.zoomedNodeData === nodeData,
          wrapperNode
        })
      }
    })

    this.flameGraph.on('hoverout', (node) => {
      if (this.tooltip) {
        this.tooltip.hide()
      }
    })

    this.flameGraph.on('animationEnd', () => {
      // Update selection marker with new node position and size
      this.markNodeAsSelected(this.ui.selectedNode)
      this.isAnimating = false

      // Show tooltip and highlight box for zoomed node after zoom completes
      if (this.ui.zoomedNode && this.ui.zoomedNode.id !== 0) {
        if (this.tooltip) {
          const rect = this.getNodeRect(this.ui.zoomedNode)
          this.tooltip.show({
            nodeData: this.ui.zoomedNode,
            rect,
            frameIsZoomed: true,
            wrapperNode: this.d3Chart.node(),
            pointerCoords: {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height
            },
            delay: 100
          })
        }
        this.ui.highlightNode(this.ui.zoomedNode)
        this.markNodeAsZoomed(this.ui.zoomedNode)
      } else {
        this.hoveredNodeData = this.ui.highlightedNode || this.ui.selectedNode
        this.highlightHoveredNodeOnGraph()
      }

      if (this.onNextAnimationEnd) {
        this.onNextAnimationEnd()
        this.onNextAnimationEnd = null
      }
    })

    // triggering the resize after the canvas rendered to take possible scrollbars into account
    this.resize(this.zoomFactor)
  }

  getNodeRect (node) {
    // Get an override for non-standard nodes e.g. from no-data-node.js
    if (node.getNodeRect) return node.getNodeRect()

    // Get a { x, y, width, height } object from d3-fg for regular nodes
    return this.flameGraph.getNodeRect(node)
  }

  highlightHoveredNodeOnGraph () {
    if (this.hoveredNodeData === null) {
      this.d3Highlighter.classed('show', false)
      this.d3HighlighterBox.classed('show', false)
      return
    }

    const rect = this.getNodeRect(this.hoveredNodeData)
    if (rect) {
      this.d3Highlighter.classed('show', true)
      this.applyRectToDiv(this.d3Highlighter, rect, true)

      this.d3HighlighterBox.classed('show', true)
      this.applyRectToDiv(this.d3HighlighterBox, Object.assign({}, rect, {
        // Align border with horizontal lines and tooltip edge
        y: rect.y + 1
      }))
    } else {
      this.d3Highlighter.classed('show', false)
      this.d3HighlighterBox.classed('show', false)
    }
  }

  markNodeAsSelected (node = null) {
    this.d3SelectionMarker.classed('hidden', !node)

    if (node) {
      const rect = this.getNodeRect(node)

      this.applyRectToDiv(this.d3SelectionMarker, Object.assign({}, {
        // Ensure marker is visible on tiny frames
        width: rect.width < 2 ? 2 : rect.width
      }, rect))
    }
  }

  markNodeAsZoomed (node = null) {
    this.d3ZoomMarker.classed('hidden', !node)

    if (node) {
      const rect = this.getNodeRect(node)
      this.applyRectToDiv(this.d3ZoomMarker, {
        x: rect.x,
        y: rect.y + rect.height * 4,
        width: rect.width,
        height: rect.height * 4
      })
    }
  }

  applyRectToDiv (d3Div, rect, aboveRect = false) {
    const scrollTop = this.d3Chart.node().scrollTop

    // If aboveRect flag is true, draws this div extending up from the top of the rectangle
    const translate = aboveRect ? `translateX(${rect.x}px)` : `translate3d(${rect.x}px, ${rect.y - scrollTop - rect.height}px, 0)`
    const height = aboveRect ? rect.y - scrollTop - rect.height : rect.height

    d3Div
      .style('width', rect.width + 'px')
      .style('height', (height < 0 ? 0 : height) + 'px')
      .style('transform', translate)
  }

  updateMarkerBoxes () {
    this.highlightHoveredNodeOnGraph()
    this.markNodeAsSelected(this.ui.selectedNode)
    if (this.ui.zoomedNode) this.markNodeAsZoomed(this.ui.zoomedNode)
  }

  resize (zoomFactor = 0) {
    this.zoomFactorChanged = this.zoomFactor !== zoomFactor
    this.zoomFactor = zoomFactor

    this.baseCellHeight = this.ui.presentationMode ? 26 : 20
    const width = this.d3Chart.node().clientWidth
    const cellHeight = this.baseCellHeight + zoomFactor
    this.sizeChanged = this.width !== width || this.cellHeight !== cellHeight
    this.width = width
    this.cellHeight = cellHeight
    this.draw()
    this.updateMarkerBoxes()
  }

  sort () {
    const sorter = this.ui.dataTree.getFilteredStackSorter()
    if (this.flameGraph) {
      this.flameGraph.sort((a, b) => {
        return sorter(a.data, b.data)
      })
    }
  }

  draw () {
    super.draw()

    const { dataTree } = this.ui
    if (this.sizeChanged) {
      this.flameGraph.width(this.width)
      this.flameGraph.cellHeight(this.cellHeight)
      this.sizeChanged = false
    }

    let redrawGraph = false

    if (this.renderedTree !== dataTree.activeTree()) {
      this.renderedTree = dataTree.activeTree()
      redrawGraph = true
    }

    if (this.showOptimizationStatus !== dataTree.showOptimizationStatus) {
      this.showOptimizationStatus = dataTree.showOptimizationStatus
      redrawGraph = true
    }

    const { toHide, toShow } = this.ui.changedExclusions
    let isChanged = false

    if (this.zoomFactorChanged) {
      redrawGraph = true
      this.zoomFactorChanged = false
    }

    // Must re-render tree before applying exclusions, else error if tree and exclusions change at same time
    if (redrawGraph) this.flameGraph.renderTree(this.renderedTree)

    if (toHide.size > 0) {
      toHide.forEach((name) => {
        this.flameGraph.typeHide(name)
      })
      isChanged = true
    }
    if (toShow.size > 0) {
      toShow.forEach((name) => {
        this.flameGraph.typeShow(name)
      })
      isChanged = true
    }

    if (isChanged || redrawGraph) this.updateMarkerBoxes()
  }
}

module.exports = FlameGraph
