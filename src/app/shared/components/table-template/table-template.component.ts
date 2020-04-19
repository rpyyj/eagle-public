import { Component, Input, OnInit, ComponentFactoryResolver, OnDestroy, ViewChild, Output, EventEmitter, SimpleChanges, OnChanges, ViewEncapsulation, ChangeDetectionStrategy } from '@angular/core';
import 'rxjs/add/operator/switchMap';
import 'rxjs/add/operator/takeUntil';
import * as _ from 'lodash';
import { StorageService } from 'app/services/storage.service';
import { TableDirective } from './table.directive';
import { TableObject } from './table-object';
import { TableComponent } from './table.component';
import { FilterObject } from './filter-object';
import { Constants } from 'app/shared/utils/constants';

@Component({
  selector: 'app-table-template',
  templateUrl: './table-template.component.html',
  styleUrls: ['./table-template.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TableTemplateComponent implements OnInit, OnChanges, OnDestroy {
  @Input() data: TableObject;
  @Input() columns: any[];
  @Input() pageSizeArray: number[];
  @Input() activePageSize: number;
  @Input() activePage: number = Constants.tableDefaults.DEFAULT_CURRENT_PAGE;
  @Input() hidePager = false;
  @Input() showMoreLoader = false;
  @Input() showMoreIncrement: number = Constants.tableDefaults.DEFAULT_SHOW_MORE_INCREMENT;
  @Input() showCountAtTop = true;
  // use the below options for dynamic search control configuration
  // These are only relevent if "showSearch" is true
  @Input() showSearch = false;
  @Input() showAdvancedSearch = false;
  @Input() searchDisclaimer: string = null;
  @Input() filters: FilterObject[];
  @Input() persistenceId: string = null;

  @ViewChild(TableDirective, {static: true}) tableHost: TableDirective;

  @Output() onPageNumUpdate: EventEmitter<any> = new EventEmitter();
  @Output() onSelectedRow: EventEmitter<any> = new EventEmitter();
  @Output() onColumnSort: EventEmitter<any> = new EventEmitter();
  @Output() onSearch: EventEmitter<any> = new EventEmitter();

  public column: string = null;

  interval: any;

  public keywords: string = null;
  public searching = false;

  public readonly constants = Constants;

  constructor(
    private componentFactoryResolver: ComponentFactoryResolver,
    private storageService: StorageService) { }

  ngOnInit() {
    // if the component is using persisted searches, check if we have any existing search configurations
    if (this.showSearch && this.persistenceId && this.persistenceId !== '' && this.storageService.state.searchComponent && this.storageService.state.searchComponent[this.persistenceId]) {
      // fetch the persistence object, for clarity in the code below
      let persistenceObject = this.storageService.state.searchComponent[this.persistenceId];
      let selectedFilters = persistenceObject.filters;

      this.filters.forEach(filter => {
        filter.selectedOptions = selectedFilters[filter.id].selectedOptions ? selectedFilters[filter.id].selectedOptions : [];
        // set dates
        if (filter.dateFilter) {
          filter.startDate = selectedFilters[filter.id].startDate;
          filter.endDate = selectedFilters[filter.id].endDate;
        }
      });
      this.keywords = persistenceObject.keywords;
      this.data.paginationData = persistenceObject.paginationData;
    }

    this.loadComponent();

    this.activePageSize = parseInt(this.data.paginationData.pageSize, 10);
    const pageSizeTemp = [10, 25, 50, 100, parseInt(this.data.paginationData.totalListItems, 10)];
    this.pageSizeArray = pageSizeTemp.filter(function(el: number) { return el >= 10; });
    this.pageSizeArray.sort(function(a: number, b: number) { return a - b });
    if (this.activePage !== parseInt(this.data.paginationData.currentPage, 10)) {
      this.activePage = parseInt(this.data.paginationData.currentPage, 10);
    }

    // Store previous and default values on the data's pagination set.
    if (this.showSearch && !this.data.paginationData.hasOwnProperty('previousFilters')) {
      this.data.paginationData.previousFilters = null;
      this.data.paginationData.previousKeyword = null;
      this.data.paginationData.defaultSortBy = this.data.paginationData.sortBy
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    // only run when property "data" changed
    if (!changes.firstChange && changes['data'].currentValue && this.data && this.data.component && this.data.paginationData && this.data.data) {
      this.data.component = changes['data'].currentValue.component;
      this.data.data = changes['data'].currentValue.data;
      this.data.paginationData = changes['data'].currentValue.paginationData;
      this.data.extraData = changes['data'].currentValue.extraData;
      this.column = changes['data'].currentValue.paginationData.sortBy;

      this.loadComponent();
    }
  }

  ngOnDestroy() {
    clearInterval(this.interval);
  }

  loadComponent() {
    if (this.data && this.data.component) {

      let componentFactory = this.componentFactoryResolver.resolveComponentFactory(this.data.component);

      let viewContainerRef = this.tableHost.viewContainerRef;
      viewContainerRef.clear();

      let componentRef = viewContainerRef.createComponent(componentFactory);
      (<TableComponent>componentRef.instance).data = this.data;

      // Don't subscribe if it doesn't exist.
      if (componentRef.instance.selectedCount) {
        componentRef.instance.selectedCount.subscribe(msg => {
          this.onSelectedRow.emit(msg);
        });
      } else {
        //  TODO: Display an error with no documents returning
      }
    }

    this.searching = false;
  }

  // Table action emits
  sort(property: string) {
    this.onColumnSort.emit(property);
  }

  updatePageNumber(pageNum) {
    this.persist();
    this.onPageNumUpdate.emit(pageNum);
  }

  updatePageSize(pageSize) {
    this.data.paginationData.pageSize = pageSize;
    this.persist();
    this.onPageNumUpdate.emit(1);
  }

  // Searching and filtering functions

  // Search is triggered when the user clicks the "search" button
  // this will create a filter set, persist if needed, and it will
  // emit to the parent container a search package that contains
  // the filters and keywords needed to perform the desired search
  search() {
    // if the new search doesnt match the old search, reset to page 1
    let newFilters = this.getFiltersForAPI();

    // if the current filters/keyword does not match previous filter/keyword
    // reset the page and sortBy back to defaults. Persist the changed values
    if (this.data.paginationData.previousKeyword !== this.keywords ||
        JSON.stringify(this.data.paginationData.previousFilters) !== JSON.stringify(newFilters)) {
      this.data.paginationData.currentPage = 1;
      this.data.paginationData.sortBy = this.data.paginationData.defaultSortBy;
      this.data.paginationData.previousFilters = { ...newFilters };
      this.data.paginationData.previousKeyword = this.keywords;
    }

    this.persist();

    // The search package to return to the parent component
    let searchPackage = {
      filterForAPI: newFilters,
      keywords: this.keywords
    }

    // emit to parent that a search has been requested
    // send the search package, consisting of filters and keyword
    this.searching = true;
    this.onSearch.emit(searchPackage);
  }

  // Build the Filter for API object. This is used by the api service
  // for sending filters to the search endpoint
  getFiltersForAPI() {
    let filtersForAPI = {};
    this.filters.forEach(filter => {
      if (filter.selectedOptions && filter.selectedOptions.length > 0) {
        filtersForAPI[filter.id] = '';
        filter.selectedOptions.forEach(option => {
          if (option.hasOwnProperty('code')) {
            filtersForAPI[filter.id] += option.code + ',';
          } else if (option.hasOwnProperty('_id')) {
            filtersForAPI[filter.id] += option._id + ',';
          } else {
            filtersForAPI[filter.id] += option + ',';
          }
        });
        filtersForAPI[filter.id] = filtersForAPI[filter.id].slice(0, -1);
      }

      if (filter.dateFilter) {
        if (filter.startDate) {
          filtersForAPI[filter.dateFilter.startDateId] = filter.startDate.year + '-' + filter.startDate.month + '-' + filter.startDate.day;
        }
        if (filter.endDate) {
          filtersForAPI[filter.dateFilter.endDateId] = filter.endDate.year + '-' + filter.endDate.month + '-' + filter.endDate.day;
        }
      }

      if (filtersForAPI[filter.id] === null || filtersForAPI[filter.id] === '') {
        delete filtersForAPI[filter.id];
      }
    });

    return filtersForAPI;
  }

  // clear all filters and keywords
  clearAllFilters() {
    this.keywords = '';
    this.filters.forEach(filter => {
      filter.selectedOptions = [];
    })
  }

  // Toggle a filter display on or off (set active to true/false)
  toggleFilter(filter: FilterObject) {
    filter.active = !filter.active;
    this.filters.forEach(otherfilter => {
      if (filter.name !== otherfilter.name) { otherfilter.active = false };
      // otherfilter.active = otherfilter.name === filter.name; would be nicer, but then we can only see one at a time
    });
  }

  // comparator for filters. We use objects in Constants, or list objects from
  // the DB, so check for the possible identifiers of code or _id. If we have
  // neither, then assume a string to string comparison
  public filterCompareWith(item: any, itemToCompare: any) {
    if (item.hasOwnProperty('code')) {
      return item && itemToCompare
        ? item.code === itemToCompare.code
        : item === itemToCompare;
    } else if (item.hasOwnProperty('_id')) {
      return item && itemToCompare
        ? item._id === itemToCompare._id
        : item === itemToCompare;
    } else {
      return item === itemToCompare;
    }
  }

  clearSelectedItem(filter: FilterObject, item: any) {
    // may have strings, or a list of code table items with _id values
    filter.selectedOptions = filter.selectedOptions.filter(option => {
      return option !== item || option._id !== item._id
    });
  }

  // If the component has a persistence ID set, it means we will persist the table
  // filters, so if a user changes pages and comes back, their previous search
  // will auto-populate
  persist() {
    if (this.showSearch && this.persistenceId && this.persistenceId !== '') {

      // if the searchComponent set doesn't exist in storage, create it
      if (!this.storageService.state.searchComponent) {
        this.storageService.state.searchComponent = {};
      }

      // if the persistenceId hasn't been created in searchComponent, create it
      if (!this.storageService.state.searchComponent[this.persistenceId]) {
        this.storageService.state.searchComponent[this.persistenceId] = {};
      }

      // fetch the persistence object for clarity in the code below
      let persistenceObject = this.storageService.state.searchComponent[this.persistenceId];

      let selectedFilters = {};
      this.filters.forEach(filter => {
        selectedFilters[filter.id] = {};
        selectedFilters[filter.id].selectedOptions = filter.selectedOptions ? filter.selectedOptions : [];
        // persist dates
        if (filter.dateFilter) {
          selectedFilters[filter.id].startDate = filter.startDate;
          selectedFilters[filter.id].endDate = filter.endDate;
        }
      });
      persistenceObject.filters = selectedFilters;
      persistenceObject.keywords = this.keywords;
      persistenceObject.paginationData = this.data.paginationData;
    }
  }
}
