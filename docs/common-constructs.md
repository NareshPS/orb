Aggregation
============
The aggregation construct defines a container that stores keyed data. It is useful to collate results into a single container.
```js
channels: {
  items: {},
  containers: {default: {}}
},

functions: [
  {
    channels: ['items', 'containers'],
    func: (item, container) => ({containers: (container[item.key] = item.value, container)})
  }
]
```

Caching
=======
The caching construct caches slow and variable data items. It makes the latest values available to the consumers without waiting for the producers.

```js
units: {
  remote: {
    channels: {
      requests: {}
    },
    functions: [
      {
        channels: ['requests'],
        func: request => {
          remotecall(request)
          .then(res => {
            this.units.local.next({items: res})
          })
        }
      }
    ]
  },
  local: {
    channels: {
      items: {}
    }
  }
}
```
