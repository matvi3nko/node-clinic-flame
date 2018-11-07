'use strict'

const shared = require('../shared.js')

class DataTree {
  constructor (tree) {
    this.merged = tree.merged
    this.unmerged = tree.unmerged

    // Set a reasonable upper limit to displayed name; exact name matching is done in analysis
    this.appName = tree.appName.length > 30 ? tree.appName.slice(0, 30) + '…' : tree.appName
    this.pathSeparator = tree.pathSeparator

    this.mergedNodes = getFlatArray(this.merged.children)
    this.unmergedNodes = getFlatArray(this.unmerged.children)

    this.useMerged = true
    this.showOptimizationStatus = false
    this.exclude = new Set(['cpp', 'regexp', 'v8', 'native', 'init'])

    // Set and updated in .update()
    this.flatByHottest = null
    this.highestStackTop = null

    this.setStackTop = shared.setStackTop.bind(this)
    this.isNodeExcluded = shared.isNodeExcluded.bind(this)
  }

  update (initial) {
    if (!initial) this.setStackTop(this.activeTree())
    this.sortFramesByHottest()
    this.computeGroupedSortValues()
    this.updateHighestStackTop()
  }

  show (name) {
    if (this.exclude.has(name)) {
      this.exclude.delete(name)
      return true
    }
    return false
  }

  hide (name) {
    if (!this.exclude.has(name)) {
      this.exclude.add(name)
      return true
    }
    return false
  }

  sortFramesByHottest () {
    // Flattened tree, sorted hottest first, excluding the 'all stacks' root node
    this.flatByHottest = this.getFlattenedSorted(this.getStackTopSorter())
  }

  activeTree () {
    return this.useMerged ? this.merged : this.unmerged
  }

  activeNodes () {
    return this.useMerged ? this.mergedNodes : this.unmergedNodes
  }

  setActiveTree (useMerged = false) {
    this.useMerged = useMerged === true

    // Showing optimization status doesn't make any sense on merged tree
    if (useMerged) this.showOptimizationStatus = false

    this.update()
  }

  getFlattenedSorted (sorter) {
    const arr = this.activeNodes()
    const filtered = arr.filter(node => !this.exclude.has(node.type))
    return filtered.sort(sorter)
  }

  updateHighestStackTop () {
    this.highestStackTop = this.flatByHottest[0].onStackTop.asViewed
  }

  getFrameByRank (rank, arr = this.flatByHottest) {
    if (!arr) return null
    return arr[rank] || null
  }

  getStackTopSorter () {
    return (nodeA, nodeB) => {
      const topA = nodeA.onStackTop.asViewed
      const topB = nodeB.onStackTop.asViewed

      // Sort highest first, treating equal as equal
      return topA === topB ? 0 : topA > topB ? -1 : 1
    }
  }

  computeGroupedSortValues () {
    this.groupedSortValues = new Map()

    const walk = (node) => {
      if (!node.children) return
      const group = Object.create(null)
      node.children.forEach((child) => {
        const value = this.getSortValue(child)
        if (child.type in group) {
          group[child.type] += value
        } else {
          group[child.type] = value
        }
      })

      node.children.forEach((child) => {
        this.groupedSortValues.set(child, group[child.type])
        walk(child)
      })
    }

    walk(this.activeTree())
  }

  isOffScreen(node) {
    // d3-fg sets `value` to 0 to hide off-screen nodes.
    // there's no other property to indicate this but the original value is stored on `.original`.
    return node.value === 0 && typeof node.original === 'number'
  }

  getSortValue (node) {
    if (this.exclude.has(node.type)) {
      // Value of hidden frames is the sum of their visible children
      return node.children ? node.children.reduce((acc, child) => {
        return acc + this.getSortValue(child)
      }, 0) : 0
    }

    return this.isOffScreen(node) ? node.original : node.value
  }

  getFilteredStackSorter () {
    return (nodeA, nodeB) => {
      const groupA = this.groupedSortValues.get(nodeA)
      const groupB = this.groupedSortValues.get(nodeB)
      if (groupA > groupB) return -1
      if (groupA < groupB) return 1

      const valueA = this.getSortValue(nodeA)
      const valueB = this.getSortValue(nodeB)

      return valueA === valueB ? 0 : valueA > valueB ? -1 : 1
    }
  }

  getSortPosition (node, arr = this.flatByHottest) {
    return arr.indexOf(node)
  }

  countFrames (arr = this.flatByHottest) {
    return arr ? arr.length : 0
  }

  getNodeById (id) {
    const arr = this.activeNodes()
    return arr.find((node) => node.id === id)
  }
}

function getFlatArray (children) {
  // Flatten the tree, excluding the root node itself (i.e. the 'all stacks' node)
  return [...children].concat(children.reduce((arr, child) => {
    if (child.children) {
      return arr.concat(getFlatArray(child.children))
    }
    return arr
  }, []))
}

module.exports = DataTree
