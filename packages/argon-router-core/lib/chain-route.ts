import {
  createEffect,
  createEvent,
  createStore,
  Effect,
  EventCallable,
  sample,
  split,
  Store,
  Unit,
} from 'effector';
import { Route, RouteOpenedPayload, VirtualRoute } from './types';

type BeforeOpenUnit<T> =
  | EventCallable<RouteOpenedPayload<T>>
  | Effect<RouteOpenedPayload<T>, any>;

interface ChainRouteProps<T> {
  route: Route<T>;
  beforeOpen: BeforeOpenUnit<T> | BeforeOpenUnit<T>[];
  openOn?: Unit<any> | Unit<any>[];
  cancelOn?: Unit<any> | Unit<any>[];
}

function createVirtualRoute<T>(pending: Store<boolean>): VirtualRoute<T> {
  const $params = createStore<T>(null as T);
  const $isOpened = createStore(false);
  const $isPending = pending;

  const open = createEvent<RouteOpenedPayload<T>>();

  const opened = createEvent<RouteOpenedPayload<T>>();
  const openedOnServer = createEvent<RouteOpenedPayload<T>>();
  const openedOnClient = createEvent<RouteOpenedPayload<T>>();

  const close = createEvent();
  const closed = createEvent();

  sample({
    clock: open,
    target: opened,
  });

  split({
    source: opened,
    match: () => (typeof window === 'undefined' ? 'server' : 'client'),
    cases: {
      server: openedOnServer,
      client: openedOnClient,
    },
  });

  sample({
    clock: close,
    target: closed,
  });

  sample({
    clock: [opened.map(() => true), closed.map(() => false)],
    target: $isOpened,
  });

  return {
    $params,
    $isOpened,
    $isPending,

    open,
    opened,
    openedOnClient,
    openedOnServer,

    close,
    closed,

    // @ts-expect-error emulated path for virtual route
    path: null,

    '@@unitShape': () => ({
      params: $params,
      isOpened: $isOpened,
      isPending: $isPending,

      onOpen: open,
    }),
  };
}

/**
 * @link https://movpushmov.dev/argon-router/core/chain-route.html
 * @param props Chain route props
 * @returns `Virtual route`
 * @example ```ts
 * import { createRoute, chainRoute } from '@argon-router/core';
 * import { createEvent, createEffect } from 'effector';
 *
 * // base example
 * const route = createRoute({ path: '/profile' });
 *
 * const authorized = createEvent();
 * const rejected = createEvent();
 *
 * const checkAuthorizationFx = createEffect(async ({ params }) => {
 *     // some logic
 * });
 *
 * sample({
 *   clock: checkAuthorizationFx.doneData,
 *   target: authorized,
 * });
 *
 * sample({
 *   clock: checkAuthorizationFx.failData,
 *   target: rejected,
 * });
 *
 * const virtual = chainRoute({
 *   route,
 *   beforeOpen: checkAuthorizationFx,
 *   openOn: authorized,
 *   cancelOn: rejected,
 * });
 *
 * // chain already chained routes
 * const postRoute = createRoute({ path: '/post/:id' });
 * const authorizedRoute = chainRoute({ route: postRoute, ... });
 * const postLoadedRoute = chainRoute({ route: authorizedRoute, ... });
 * ```
 */
export function chainRoute<T>(props: ChainRouteProps<T>): VirtualRoute<T> {
  const { route, beforeOpen, openOn, cancelOn } = props;

  const openFx = createEffect(async (payload: RouteOpenedPayload<T>) => {
    for (const trigger of (<BeforeOpenUnit<T>[]>[]).concat(beforeOpen)) {
      await trigger(payload);
    }
  });

  const virtualRoute = createVirtualRoute<T>(openFx.pending);

  sample({
    clock: route.open,
    target: openFx,
  });

  sample({
    clock: route.opened,
    fn: (payload) =>
      (payload && 'params' in payload ? payload.params : null) as T,
    target: virtualRoute.$params,
  });

  if (openOn) {
    // @ts-expect-error ...
    sample({
      clock: openOn,
      source: { params: virtualRoute.$params },
      fn: ({ params }) => ({ params }) as unknown as RouteOpenedPayload<T>,
      target: virtualRoute.open,
    });
  }

  if (cancelOn) {
    sample({
      clock: (<Unit<void>[]>[route.closed]).concat(cancelOn),
      target: virtualRoute.close,
    });
  }

  return virtualRoute;
}
