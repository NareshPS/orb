const logger = require('./logger.js')
const {Subject, BehaviorSubject, Observable, of, combineLatest, zip} = require('rxjs')
const { withLatestFrom, bufferCount, first, buffer, switchMap, mergeAll} = require('rxjs/internal/operators')

const trace = ({debug}) => args => debug? console.info(...args): undefined

class Unit {
  constructor(o) {
    this.name = o.name
    this.functions = o.functions || []
    this.trace = trace(o)
    this.aggregates = new Aggregates(this)
    this.resolution = resolution(this)
    this.channels = Object.entries(o.channels || {})
    .reduce((chs, [name, config]) => (chs[name] = this._construct.subject({name, config}), chs), {})
  }

  _morph = ({channels, context = this.resolution}) => (
    Object.entries(channels)
    .forEach(([name, config]) => this.channels[name] = this._construct.morphSubject({source: {unit: this.name, channel: name}, config, context}))
  )
  
  start() {
    this.functions.forEach(
      ({type = 'first', channels = {}, func = _ => ({})}) => (
        this.aggregates.get(type, channels).subscribe(o => this.publish(func(o)))
      ))
  }

  stop() {Object.values(this.channels).forEach(s => s.unsubscribe())}
  next(o) { this.publish(o) }


  static filters = {
    channel: {
      alien: ([name, config]) => config.provider || config.channel || config.unit,
    }
  }
  
  _construct = {
    subject: ({name, config: c}) => {
      const subject = (c.default? new BehaviorSubject(c.default): new Subject())

      return Pipe.apply({subject, pipes: c.pipes, channel: name})
    },

    morphSubject: ({source, config: c, context}) => {
      const pc = context.pconfig(c)
      const subject = context.pchannel(source, pc)

      return Pipe.apply({subject, pipes: c.pipes, channel: source.channel})
    },
  }
  
  subscribe = o => Object.entries(o).forEach(([c, f]) => this.get(c).subscribe(f))
  get = name => this.channels[name] || new InvalidChannel(name, this)
  info = _ => `[channels: [${Object.keys(this.channels)}]]`
  
  publish = o => (
    Object.entries(o || {}).forEach(([name, data]) => this.get(name).next(data))
  )
}

class Network extends Unit {
  /**
   * Units and the network may have dependencies.
   * They can be cyclic. This poses problems to create units with dependencies.
   * To circumvent this problem, we filter out the dependencies.
   * Once the units are created, they are morhped to the desired form.
   */
  constructor(o) {
    o = {
      channels: o.channels || {},
      functions: o.functions || [],
      ...o,
    }

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
    .reduce((us, {name, channels, functions}) => ((us[name] = new Unit({name, channels, functions})), us), {})

    // Morph the network
    this._morph({
      channels: Object.fromEntries(Object.entries(o.channels).filter(filters.in)),
    })

    // Morph the units
    Object.entries(o.units || {}).forEach(([name, u]) => {
      const mu = this.units[name]
      const mp = {
        channels: Object.fromEntries(Object.entries(u.channels).filter(filters.in)),
        context: this.resolution
      }

      logger.info(`units.Network: Morphing unit: ${name} channels: [${Object.entries(u.channels).filter(filters.in)}]`)
      mu._morph(mp)
    })

    logger.info(`unit.Network: Network configuration: `, Object.entries(this.units).map(([name, u]) => {name, u.info()}))
  }

  start() {
    Object.entries(this.units).map(([name, u]) => {
      logger.info(`unit.Network.start: ${name}`)
      u.start()
    })
    super.start()
  }
}

class Aggregates {
  constructor(unit) {
    this.unit = unit
  }

  get = (type, channels) => {
    logger.info(`unit.Aggregates.get: type: ${type} unit: ${this.unit.name} channels: ${channels}`)

    const obs = channels.map((ch) => this.unit.get(ch))
    const func = this[type] || this.first

    return func(obs)
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

  any = ([first, ...rest]) => (rest? combineLatest([first, ...rest]): first)
  all = obs => zip(...obs)
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
    this._nr = new NextRequest(this)
    this.trace = []

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

    const forward = ({unit, channel, unwrap}) => {
      this.trace.push({unit: unit.name, channel})

      unit.next({[channel]: this._nr.get(to)})

      return unwrap && this.next()
    }

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

  empty = _ => this.stack.length === 0

  _toChanged = _ => this.request.to = this.element.to().request
  _fromChanged = r => this.request.from = r
}

const newTrip = elements => new Trip(elements)

class NextRequest {
  constructor(trip) {
    this.trip = trip
  }

  get = (to) => {
    const {request, unwrap, map, tap} = to
    const mapFunc = t => (map && (this.trip.request.from = map(request)), t)
    const unwrapFunc = t => unwrap? typeof unwrap === 'function'? unwrap(request): request: t
    const tapFunc = t => (tap && tap(request), t)

    return [tapFunc, mapFunc, unwrapFunc].reduce((t, fn) => fn(t), this.trip)
  }
}

class NoopUnit extends Unit {
  constructor() {super({})}
  
  next() { }
}

class InvalidChannel extends Observable {
  constructor(name, unit = {}) {
    super(s => {this.throw()})
    this.name = name
    this.unit = unit
  }

  next() {
    this.throw()
  }

  throw() {
    throw new Error(`invalid unit: ${this.unit.name} channel: ${this.name} combination`)
  }
}

const resolution = ctx => new Resolution(ctx)
class Resolution {
  constructor(context) {
    this.context = context || {}
  }

  _resolvepunit = (source, p) => (
    ((this.context.units || {})[p.unit]) || (p.unit === this.context.name? this.context: p.unit instanceof Unit? p.unit: ErrorPUnit(p, source))
  )

  pchannel = (source, pc) => {
    const pu = this._resolvepunit(source, pc)

    return pu.get(pc.channel) || ErrorPChannel({unit: pu.name, channel: pc.channel}, source)
  }

  pconfig = c => ({
    unit: c.unit || (c.provider? c.provider.unit: undefined),
    channel: c.channel || (c.provider? c.provider.channel: undefined)
  })
}

const ErrorPUnit = (p, container) => ({
  get: _ => {
    throw new Error(`invalid unit: ${p.unit} container: {unit: ${container.unit}, channel: ${container.channel}}`)
  },
})

const ErrorPChannel = (pc, container) => {
  throw new Error(`invalid channel: ${pc.channel} container: {unit: ${container.unit}, channel: ${container.channel}}`)
}

const ErrorPipe = (p, source) => _ => ({next: _ => {throw new Error(`invalid pipe: ${p} source: ${source}`)}})

module.exports = {Unit, Network, Partition, Reduction, Trip, newTrip}
