const { buffer, bufferCount } = require('rxjs/internal/operators')
const {Network, Unit, Partition, Route, Trip} = require('../../src/unit.js')

testNetwork = _ => {
  const network = new Network({
    name: 'network',
    channels: {
      equations: {},
      results: {}
    },
    functions: [
      {
        channels: ['equations'],
        func: ({input, route}) => {
          const t = new Trip(...network.routes[route])
          t.attach({input})

          t.next()
        }
      },
      {
        channels: ['results'],
        func: t => {
          console.info(t.request.current)
        }
      }
    ],
    units: {
      square: {
        channels: {
          number: {},
        },
        functions: [
          {
            channels: ['number'],
            func: t => {
              const r = t.request.current
              console.info(r)

              t.request.mergeNext({input: r.input**2})

              t.next()
            }
          }
        ]
      },
      scaling: {
        channels: {
          number: {},
        },
        functions: [{
          channels: ['number'],
          func: t => {
            const r = t.request.current

            console.info(r)

            t.request.mergeNext({input: r.input*r.factor})
            t.next()
          }
        }]
      }
    },
    routes: {
      equationone: [{unit: 'square', channel: 'number'}, {unit: 'scaling', channel: 'number', request: {factor: 5}}, {unit: 'network', channel: 'results'}],
      equationtwo: [{unit: 'scaling', channel: 'number', request: {factor: 2}}, {unit: 'square', channel: 'number'}, {unit: 'network', channel: 'results'}],
    }
  })
  
  network.start()
  network.next({
    equations: {
      input: 5,
      route: 'equationtwo'
    }
  })
  network.next({
    equations: {
      input: 5,
      route: 'equationone'
    }
  })
}

testUnit = _ => {
  const unit = new Unit({
    channels: {number: {}, squares: {}},
    functions: [{
      channels: ['number'],
      func: n => ({squares: n*n})
    }]
  })

  unit.start()
  unit.subscribe({squares: sq => console.info(`squares: `, sq)})
  unit.next({number: 5})
}

testTwoUnits = _ => {
  const square = new Unit({
    channels: {number: {}, squares: {}},
    functions: [{
      channels: ['number'],
      func: n => ({squares: n*n})
    }]
  })
  
  const double = new Unit({
    channels: {
      number: {provider: {unit: square, channel: 'squares'}},
      doubles: {}
    },
    functions: [{
      channels: ['number'],
      func: n => ({doubles: 2*n})
    }]
  })

  square.start()
  double.start()

  double.subscribe({doubles: d => console.info(`double: `, d)})
  square.next({number: 5})
}

testPartition = _ => {
  const partition = new Partition({
    channels: ['source', 'red', 'green']
  })

  partition.start()
  partition.subscribe({red: x => console.info(`red: `, x), green: x => console.info(`green: `, x)})
  partition.next({source: {type: 'red'}})
}

testPipes = _ => {
  const product = new Unit({
    channels: {
      number: {pipes: [bufferCount(2)]},
      products: {}
    },
    functions: [{
      channels: ['number'],
      func: ([n1, n2]) => ({products: n1 * n2})
    }]
  })

  product.start()
  product.subscribe({
    products: console.info
  })

  product.next({number: 5})
  setTimeout(_ => product.next({number: 8}), 4000)
}

testAggregates = _ => {
  const u = new Unit({
    channels: {
      c1: {default: 1},
      c2: {default: 2},
      c3: {default: 3},
      c4: {default: 4},
      c5: {default: 5},
    },
    functions: [
      {
        channels: ['c1', 'c2', 'c3', 'c4', 'c5'],
        func: console.info
      }
    ]
  })

  u.start()
}

const testTrip = _ => {
  const unit = new Unit({
    channels: {
      start: {},
      c1: {},
      c2: {},
      c3: {},
    },
    functions: [
      {
        channels: ['start'],
        func: _ => {
          const t = new Trip()

          t.attach({type: 'preappend'})
          t.append(
            {unit, channel: 'c1', request: {name: 'hello1'}},
            {unit, channel: 'c3', request: {name: 'hello3'}},
            {unit, channel: 'c2', request: {name: 'hello2'}},
          )

          t.next()
        }
      },
      {
        channels: ['c1'],
        func: t => {
          const request = t.request.from
          console.info(request.name)
          t.next()
        }
      },
      {
        channels: ['c2'],
        func: t => {
          const request = t.request.from
          console.info(request.name)
          t.next()
        }
      },
      {
        channels: ['c3'],
        func: t => {
          const request = t.request.from
          console.info(request.name)
          t.next()
        }
      }
    ]
  })

  unit.start()
  unit.next({start: 1})
}

// testAggregates()
// testTrip()

// testUnit()
testTwoUnits()
// testNetwork()
testPipes()
