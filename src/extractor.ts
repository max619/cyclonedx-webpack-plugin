/*!
This file is part of CycloneDX Webpack plugin.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
Copyright (c) OWASP Foundation. All Rights Reserved.
*/

import type * as CDX from '@cyclonedx/cyclonedx-library'
import type { Compilation, Module } from 'webpack'

import type {
  PackageDescription} from './_helpers'
import {
  getPackageDescription,
  isNonNullable} from './_helpers'
import type {RichComponentBuilder} from './richComponentBuilder'

type WebpackLogger = Compilation['logger']

export class Extractor {
  readonly #compilation: Compilation
  readonly #componentBuilder: RichComponentBuilder

  constructor (
    compilation: Compilation,
    componentBuilder: RichComponentBuilder,
  ) {
    this.#compilation = compilation
    this.#componentBuilder = componentBuilder
  }

  generateComponents (modules: Iterable<Module>, componentSubstitutionMap: Map<string, CDX.Models.Component>, collectEvidence: boolean, logger?: WebpackLogger): Iterable<CDX.Models.Component> {
    const pkgs: Record<string, CDX.Models.Component | undefined> = {}
    const components = new Map<Module, CDX.Models.Component>()

    logger?.log('start building Components from modules...')
    for (const module of modules) {
      if (module.context === null) {
        logger?.debug('skipping', module)
        continue
      }
      const pkg = getPackageDescription(module.context)
      if (pkg === undefined) {
        logger?.debug('skipped package for', module.context)
        continue
      }
      let component = pkgs[pkg.path]
      if (component === undefined) {
        logger?.log('try to build new Component from PkgPath:', pkg.path)
        try {
          component = this.#makeComponent(pkg, componentSubstitutionMap, collectEvidence, logger)
        } catch (err) {
          logger?.debug('unexpected error:', err)
          logger?.warn('skipped Component from PkgPath', pkg.path)
          continue
        }
        logger?.debug('built', component, 'based on', pkg, 'for module', module)
        pkgs[pkg.path] = component
      }
      components.set(module, component)
    }

    logger?.log('linking Component.dependencies...')
    this.#linkDependencies(components)

    logger?.log('done building Components from modules...')
    return components.values()
  }

  /**
   * @throws {@link Error} when no component could be fetched
   */
  #makeComponent(pkg: PackageDescription, componentSubstitutionMap: Map<string, CDX.Models.Component>, collectEvidence: boolean, logger?: WebpackLogger): CDX.Models.Component
  {
    const newComponent = this.#componentBuilder.makeComponent(pkg, collectEvidence, logger)
    if(newComponent === undefined) {
      throw Error(`failed building Component from PkgPath ${pkg.path}`)
    }

    if(newComponent.bomRef.value !== undefined) {
      const remappedComponent = componentSubstitutionMap.get(newComponent.bomRef.value)
      if(remappedComponent !== undefined) {
        return remappedComponent
      }
    }

    return newComponent
  }

  #linkDependencies (modulesComponents: Map<Module, CDX.Models.Component>): void {
    for (const [module, component] of modulesComponents) {
      for (const dependencyModule of module.dependencies.map(d => this.#compilation.moduleGraph.getModule(d)).filter(isNonNullable)) {
        const dependencyBomRef = modulesComponents.get(dependencyModule)?.bomRef
        if (dependencyBomRef !== undefined) {
          component.dependencies.add(dependencyBomRef)
        }
      }
    }
  }
}
