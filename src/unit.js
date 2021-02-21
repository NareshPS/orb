const logger = require('./logger.js')
const {Subject, BehaviorSubject, Observable, of, combineLatest} = require('rxjs')
const { withLatestFrom, bufferCount, first, buffer, switchMap, mergeAll} = require('rxjs/internal/operators')

class Unit {
  constructor(o) {
    this.name = o.name
    this.functions = o.functions || []
    this.aggregates = new Aggregates(this)
    this.resolution = new Resolution(this)
    this.channels = Object.entries(o.channels || {})
    .reduce((chs, [name, config]) => (chs[name] = this._construct.subject({name, config}), chs), {})
  }

  _morph = o => (
    Object.entries(o.channels).forEach(([name, config]) => this.channels[name] = this._construct.subject({name, config}))
  )
  
  start() {
    this.functions.forEach(
      ({type, channels, func}) => (
        this.aggregates.get(type, channels).subscribe(o => this.publish(func(o)))
      ))
  }

  stop() {Object.values(this.channels).forEach(s => s.unsubscribe())}
  next(o) { this.publish(o) }


  static filters = {
    channel: {
      alien: ([name, config]) => config.provider,
    }
  }
  
  _construct = {
    subject: ({name, config: c}) => {
      const subject = (c.provider? 
      ((c.provider.unit || ErrorPUnit(this.name, name, `unit.Unit._construct`)).get(c.provider.channel) || ErrorPChannel(this.name, name, `unit.Unit._construct`)):
      (c.default? new BehaviorSubject(c.default): new Subject()))

      return Pipe.apply({subject, pipes: c.pipes, channel: name})
    }
  }
  
  subscribe = o => Object.entries(o).forEach(([c, f]) => (this.channels[c] || ErrorChannel(this.name, c)).subscribe(f))
  get = name => this.channels[name]
  info = _ => `[channels: [${Object.keys(this.channels)}]]`
  
  publish = o => (
    Object.entries(o || {}).forEach(([name, data]) => (this.get(name) || ErrorChannel(this.name, name)).next(data))
  )
}

const ErrorPUnit = (u, c, source) => ({
  get: _ => {throw new Error(`invalid provider unit for unit: ${u} channel: ${c} source: ${source}`)},
})

const ErrorPChannel = (u, c, source) => new Observable(_ => {throw new Error(`invalid provider channel for unit: ${u} channel: ${c} source: ${source}`)})

const ErrorChannel = (u, c) => ({
  next: _ => {throw new Error(`invalid unit: ${u} channel: ${c}`)},
  subscribe: _ => {throw new Error(`invalid unit: ${u} channel: ${c}`)}
})

const ErrorUnit = (u, source) => ({
  next: _ => {throw new Error(`invalid unit: ${u} source: ${source}`)},
  get: _ => {throw new Error(`invalid unit: ${u} source: ${source}`)}
})

const ErrorPipe = (p, source) => _ => ({next: _ => {throw new Error(`invalid pipe: ${p} source: ${source}`)}})

class Network extends Unit {
  /**
   * Units and the network may have dependencies.
   * They can be cyclic. This poses problems to create units with dependencies.
   * To circumvent this problem, we filter out the dependencies.
   * Once the units are created, they are morhped to the desired form.
   */
  constructor(o) {
    const filters = {
      out: i => !Unit.filters.channel.alien(i),
      in: i => Unit.filters.channel.alien(i)
    }

    super({
      channels: Object.fromEntries(Object.entries(o.channels).filter(filters.out)),
      functions: o.functions
    })

    this.name = o.name
    this.units = Object.entries(o.units || {})
    .map(([name, unit]) => ({
      name,
      channels: Object.fromEntries(Object.entries(unit.channels).filter(filters.out)),
      functions: unit.functions
    }))
    .reduce((us, {name, channels, functions}) => ((us[name] = new Unit({name, functions, channels})), us), {})
    
    const morphFunc = ([name, config]) => ([
      name,
      (
        config.provider = {
          unit: this.resolution.punit(config.provider.channel, config.provider.unit),
          channel: config.provider.channel
        },
        config
      )
    ])

    // Morph the network
    this._morph({
      channels: Object.fromEntries(Object.entries(o.channels).filter(filters.in).map(morphFunc)),
    })

    // Morph the units
    Object.entries(o.units || {}).forEach(([name, u]) => {
      const mu = this.units[name]
      const mp = {
        channels: Object.fromEntries(Object.entries(u.channels).filter(filters.in).map(morphFunc)),
      }

      logger.info(`units.Network: Morphing unit: ${name} channels: [${Object.entries(u.channels).filter(filters.in)}]`)
      mu._morph(mp)
    })

    // Construct routes
    this.routes = Object.fromEntries(
      Object.entries(o.routes || {})
      .map(([name, route = []]) => [name, route.map(this.resolution.provider)])
    )

    logger.info(`unit.Network: Network configuration: `, Object.entries(this.units).map(([name, u]) => {name, u.info()}))
  }

  start() {
    Object.entries(this.units).map(([name, u]) => (logger.info(`unit.Network.start: ${name}`), u.start()))
    super.start()
  }

  newTrip(route) {
    return new Trip(this, route)
  }
}

class Aggregates {
  constructor(unit) {
    this.unit = unit
  }

  get = (type, channels) => {
    logger.info(`unit.Aggregates.get: type: ${type} unit: ${this.unit.name} channels: ${channels}`)

    const obs = channels.map((ch) => this.unit.get(ch) || ErrorPChannel(this.unit.name, ch, `Aggregates.get`))

    switch(type) {
      case 'anylatest':
        return this.anylatest(obs)
      default:
        return this.first(obs)
    }
  }

  first = ([start, ...rest]) => {
    return rest.length > 0
    ? of(
        start.pipe(buffer(combineLatest(rest)), first(), switchMap(v => of(...v))), // buffer the first that arrive before rest.
        start
      )
      .pipe(
        mergeAll(),
        withLatestFrom(...rest)
      )
    : start
  }

  anylatest = ([first, ...rest]) => (console.dir(rest? combineLatest([first, ...rest]): first),(rest? combineLatest([first, ...rest]): first))
}

class Partition extends Unit {
  static Type = 'type'

  constructor(o) {
    super({
      channels: o.channels,
      functions: [{
        type: 'first',
        channels: [o.source],
        func: (x) => ({[x[Partition.Type]]: x})
      }]
    })
  }
}

class Reduction extends Unit {
  constructor(o) {
    super({
      name: o.name,
      channels: {
        reductions: { pipes: [bufferCount(o.count)] }
      },
      functions: [
        {
          channels: ['reductions'],
          func: o.func
        }
      ]
    })
  }
}

class Pipe {
  static apply = o => o.pipes? Pipe.route(o): o.subject
  static route = o => o.pipes.reduce((s, p, index) => s.pipe(p || ErrorPipe(o.channel, `unit.Pipe.route: pipe.index:${index}`)), o.subject)
}

class Trip {
  constructor(...elements) {
    this.stack = (elements || []).map((e) => this.element.get(e)).reverse()

    this._toChanged()
  }

  /**
   * It sets the trip request and updates the next request.
   * 
   * @param {Object} r 
   */
  attach = r => {
    this.request.trip = (r || {})
  }

  element = {
    get: (e = {}) => {
      const {request = {}, unit = new NoopUnit(), ...rest} = e

      return ({request, unit, ...rest})
    },
    to: _ => (this.element.get(this.stack[this.stack.length - 1]))
  }

  request = {
    trip: {},
    from: {},
    to: {},
    mergeTo: mo => Object.assign(this.request.to, mo),
  }

  next = _ => {
    const to = this.element.get(this.stack.pop())
    this._fromChanged(this.request.to)
    this._toChanged()

    const forward = ({unit, channel}) => resolution().unit(unit).next({[channel]: this})
    forward(to)
  }

  append = (...elements) => (
    this.stack.push(...elements.map((e) => this.element.get(e)).reverse()),
    this._toChanged()
  )

  copy =  _ => new Trip(
    ...this.stack
    .reverse()
    .map(({request, ...rest}) => ({request: {...request}, ...rest}))
  )

  _toChanged = _ => this.request.to = this.element.to().request
  _fromChanged = r => this.request.from = r
}

class NoopUnit extends Unit {
  constructor() {super({})}
  
  next() {
  }
}

const resolution = ctx => new Resolution(ctx)
class Resolution {
  constructor(context) {
    this.context = context || {}
  }

  unit = u => u instanceof Unit? u: ErrorUnit(u, 'unit.Resolution.unit')
  punit = (c, pu) => this._resolvepunit(pu) || ErrorPUnit(c, this.context.name, `unit.Resolution.providerunit`)
  _resolvepunit = pu => (((this.context.units || {})[pu]) || (pu === this.context.name? this.context: pu instanceof Unit? pu: undefined))
  provider = ({unit, channel, ...rest}) => ({unit: this.punit(channel, unit), channel, ...rest})
}

module.exports = {Unit, Network, Partition, Reduction, Trip}
