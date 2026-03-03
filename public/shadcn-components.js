// Shadcn/UI Components Library for Preview Environment
// This file makes shadcn components available in the browser preview

(function() {
  // Utility function for class merging (simplified version of cn)
  function cn(...classes) {
    return classes.filter(Boolean).join(' ');
  }

  // Button Component (simplified browser version)
  const Button = ({ children, variant = 'default', size = 'default', className = '', ...props }) => {
    const baseClasses = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2';

    const variants = {
      default: 'bg-slate-900 text-white hover:bg-slate-800',
      destructive: 'bg-red-500 text-white hover:bg-red-600',
      outline: 'border border-slate-300 bg-white hover:bg-slate-50',
      secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
      ghost: 'hover:bg-slate-100',
      link: 'text-slate-900 underline-offset-4 hover:underline'
    };

    const sizes = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 px-3',
      lg: 'h-11 px-8',
      icon: 'h-10 w-10'
    };

    return React.createElement('button', {
      className: cn(baseClasses, variants[variant], sizes[size], className),
      ...props
    }, children);
  };

  // Card Components
  const Card = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('rounded-lg border bg-white shadow-sm', className),
      ...props
    }, children);
  };

  const CardHeader = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex flex-col space-y-1.5 p-6', className),
      ...props
    }, children);
  };

  const CardTitle = ({ children, className = '', ...props }) => {
    return React.createElement('h3', {
      className: cn('text-2xl font-semibold leading-none tracking-tight', className),
      ...props
    }, children);
  };

  const CardDescription = ({ children, className = '', ...props }) => {
    return React.createElement('p', {
      className: cn('text-sm text-slate-500', className),
      ...props
    }, children);
  };

  const CardContent = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('p-6 pt-0', className),
      ...props
    }, children);
  };

  const CardFooter = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex items-center p-6 pt-0', className),
      ...props
    }, children);
  };

  // Input Component
  const Input = ({ type = 'text', className = '', ...props }) => {
    return React.createElement('input', {
      type,
      className: cn(
        'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      ),
      ...props
    });
  };

  // Label Component
  const Label = ({ children, className = '', ...props }) => {
    return React.createElement('label', {
      className: cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className),
      ...props
    }, children);
  };

  // Badge Component
  const Badge = ({ children, variant = 'default', className = '', ...props }) => {
    const variants = {
      default: 'border-transparent bg-slate-900 text-white',
      secondary: 'border-transparent bg-slate-100 text-slate-900',
      destructive: 'border-transparent bg-red-500 text-white',
      outline: 'text-slate-950'
    };

    return React.createElement('div', {
      className: cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        variants[variant],
        className
      ),
      ...props
    }, children);
  };

  // Avatar Components
  const Avatar = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className),
      ...props
    }, children);
  };

  const AvatarImage = ({ src, alt = '', className = '', ...props }) => {
    return React.createElement('img', {
      src,
      alt,
      className: cn('aspect-square h-full w-full', className),
      ...props
    });
  };

  const AvatarFallback = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex h-full w-full items-center justify-center rounded-full bg-slate-100', className),
      ...props
    }, children);
  };

  // Table Components
  const Table = ({ children, className = '', ...props }) => {
    return React.createElement('table', {
      className: cn('w-full caption-bottom text-sm', className),
      ...props
    }, children);
  };

  const TableHeader = ({ children, className = '', ...props }) => {
    return React.createElement('thead', {
      className: cn('[&_tr]:border-b', className),
      ...props
    }, children);
  };

  const TableBody = ({ children, className = '', ...props }) => {
    return React.createElement('tbody', {
      className: cn('[&_tr:last-child]:border-0', className),
      ...props
    }, children);
  };

  const TableRow = ({ children, className = '', ...props }) => {
    return React.createElement('tr', {
      className: cn('border-b transition-colors hover:bg-slate-50', className),
      ...props
    }, children);
  };

  const TableHead = ({ children, className = '', ...props }) => {
    return React.createElement('th', {
      className: cn('h-12 px-4 text-left align-middle font-medium text-slate-500', className),
      ...props
    }, children);
  };

  const TableCell = ({ children, className = '', ...props }) => {
    return React.createElement('td', {
      className: cn('p-4 align-middle', className),
      ...props
    }, children);
  };

  // Separator Component
  const Separator = ({ orientation = 'horizontal', className = '', ...props }) => {
    return React.createElement('div', {
      className: cn(
        'shrink-0 bg-slate-200',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className
      ),
      ...props
    });
  };

  // Dialog Components (simplified browser version)
  const Dialog = ({ open, onOpenChange, children }) => {
    if (!open) return null;

    return React.createElement('div', {
      className: 'fixed inset-0 z-50 flex items-center justify-center',
      onClick: () => onOpenChange && onOpenChange(false)
    }, children);
  };

  const DialogOverlay = ({ className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('fixed inset-0 bg-black/50 backdrop-blur-sm', className),
      ...props
    });
  };

  const DialogContent = ({ children, className = '', onClose, ...props }) => {
    return React.createElement('div', {
      className: 'fixed inset-0 z-50 flex items-center justify-center p-4',
      onClick: onClose
    },
      React.createElement(DialogOverlay),
      React.createElement('div', {
        className: cn(
          'relative bg-white rounded-lg shadow-lg p-6 w-full max-w-lg z-50',
          className
        ),
        onClick: (e) => e.stopPropagation(),
        role: 'dialog',
        'aria-modal': 'true',
        ...props
      },
        children,
        React.createElement('button', {
          onClick: onClose,
          className: 'absolute top-4 right-4 text-slate-500 hover:text-slate-900',
          'aria-label': 'Close'
        }, '×')
      )
    );
  };

  const DialogHeader = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex flex-col space-y-2 mb-4', className),
      ...props
    }, children);
  };

  const DialogTitle = ({ children, className = '', ...props }) => {
    return React.createElement('h2', {
      className: cn('text-lg font-semibold', className),
      ...props
    }, children);
  };

  const DialogDescription = ({ children, className = '', ...props }) => {
    return React.createElement('p', {
      className: cn('text-sm text-slate-500', className),
      ...props
    }, children);
  };

  const DialogFooter = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('flex justify-end space-x-2 mt-4', className),
      ...props
    }, children);
  };

  // Select Components (simplified browser version)
  const Select = ({ value, onValueChange, children }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return React.createElement('div', {
      className: 'relative'
    },
      React.Children.map(children, child => {
        if (child && child.type === SelectTrigger) {
          return React.cloneElement(child, {
            onClick: () => setIsOpen(!isOpen),
            isOpen
          });
        }
        if (child && child.type === SelectContent && isOpen) {
          return React.cloneElement(child, {
            onSelect: (val) => {
              onValueChange(val);
              setIsOpen(false);
            }
          });
        }
        return child;
      })
    );
  };

  const SelectTrigger = ({ children, className = '', onClick, isOpen, ...props }) => {
    return React.createElement('button', {
      type: 'button',
      className: cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm',
        className
      ),
      onClick,
      'aria-expanded': isOpen,
      ...props
    }, children);
  };

  const SelectValue = ({ placeholder, value }) => {
    return React.createElement('span', {}, value || placeholder);
  };

  const SelectContent = ({ children, onSelect, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn(
        'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white py-1 shadow-lg',
        className
      ),
      ...props
    },
      React.Children.map(children, child => {
        if (child && child.type === SelectItem) {
          return React.cloneElement(child, { onSelect });
        }
        return child;
      })
    );
  };

  const SelectItem = ({ children, value, onSelect, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn(
        'relative flex cursor-pointer select-none items-center px-2 py-1.5 text-sm hover:bg-slate-100',
        className
      ),
      onClick: () => onSelect && onSelect(value),
      ...props
    }, children);
  };

  // Tabs Components
  const Tabs = ({ defaultValue, value, onValueChange, children, className = '', ...props }) => {
    const [activeTab, setActiveTab] = React.useState(value || defaultValue);

    const handleTabChange = (newValue) => {
      setActiveTab(newValue);
      if (onValueChange) onValueChange(newValue);
    };

    return React.createElement('div', {
      className: cn('w-full', className),
      ...props
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, { activeTab, onTabChange: handleTabChange });
        }
        return child;
      })
    );
  };

  const TabsList = ({ children, activeTab, onTabChange, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('inline-flex h-10 items-center justify-center rounded-md bg-slate-100 p-1', className),
      role: 'tablist',
      ...props
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, { activeTab, onTabChange });
        }
        return child;
      })
    );
  };

  const TabsTrigger = ({ children, value, activeTab, onTabChange, className = '', ...props }) => {
    const isActive = activeTab === value;

    return React.createElement('button', {
      type: 'button',
      className: cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
        isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
        className
      ),
      onClick: () => onTabChange && onTabChange(value),
      role: 'tab',
      'aria-selected': isActive,
      ...props
    }, children);
  };

  const TabsContent = ({ children, value, activeTab, className = '', ...props }) => {
    if (activeTab !== value) return null;

    return React.createElement('div', {
      className: cn('mt-2', className),
      role: 'tabpanel',
      ...props
    }, children);
  };

  // Progress Components
  const Progress = ({ value = 0, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('relative h-2 w-full overflow-hidden rounded-full bg-slate-100', className),
      role: 'progressbar',
      'aria-valuenow': value,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      ...props
    },
      React.createElement('div', {
        className: 'h-full bg-slate-900 transition-all',
        style: { width: `${value}%` }
      })
    );
  };

  const CircularProgress = ({ value = 0, size = 60, strokeWidth = 4, showValue = false, className = '', ...props }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;

    return React.createElement('div', {
      className: cn('relative inline-flex items-center justify-center', className),
      style: { width: size, height: size },
      role: 'progressbar',
      'aria-valuenow': value,
      ...props
    },
      React.createElement('svg', {
        width: size,
        height: size,
        className: 'transform -rotate-90'
      },
        React.createElement('circle', {
          cx: size / 2,
          cy: size / 2,
          r: radius,
          stroke: 'currentColor',
          strokeWidth: strokeWidth,
          fill: 'none',
          className: 'text-slate-200'
        }),
        React.createElement('circle', {
          cx: size / 2,
          cy: size / 2,
          r: radius,
          stroke: 'currentColor',
          strokeWidth: strokeWidth,
          fill: 'none',
          strokeDasharray: circumference,
          strokeDashoffset: offset,
          strokeLinecap: 'round',
          className: 'text-slate-900 transition-all duration-300'
        })
      ),
      showValue && React.createElement('span', {
        className: 'absolute text-sm font-medium'
      }, `${Math.round(value)}%`)
    );
  };

  // Checkbox Component
  const Checkbox = ({ checked, onCheckedChange, className = '', ...props }) => {
    const [isChecked, setIsChecked] = React.useState(checked || false);

    const handleChange = (e) => {
      const newValue = e.target.checked;
      setIsChecked(newValue);
      if (onCheckedChange) onCheckedChange(newValue);
    };

    return React.createElement('input', {
      type: 'checkbox',
      checked: isChecked,
      onChange: handleChange,
      className: cn(
        'h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-950',
        className
      ),
      ...props
    });
  };

  // RadioGroup Components
  const RadioGroup = ({ value, onValueChange, children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('grid gap-2', className),
      role: 'radiogroup',
      ...props
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, {
            groupValue: value,
            onGroupChange: onValueChange
          });
        }
        return child;
      })
    );
  };

  const RadioGroupItem = ({ value, groupValue, onGroupChange, className = '', ...props }) => {
    return React.createElement('input', {
      type: 'radio',
      checked: groupValue === value,
      onChange: () => onGroupChange && onGroupChange(value),
      className: cn('h-4 w-4 border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-950', className),
      ...props
    });
  };

  // Accordion Components
  const Accordion = ({ type = 'single', collapsible = true, children, className = '', ...props }) => {
    const [openItems, setOpenItems] = React.useState([]);

    const handleToggle = (value) => {
      if (type === 'single') {
        setOpenItems(openItems.includes(value) ? [] : [value]);
      } else {
        setOpenItems(
          openItems.includes(value)
            ? openItems.filter(item => item !== value)
            : [...openItems, value]
        );
      }
    };

    return React.createElement('div', {
      className: cn('w-full', className),
      ...props
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, {
            openItems,
            onToggle: handleToggle
          });
        }
        return child;
      })
    );
  };

  const AccordionItem = ({ value, children, openItems, onToggle, className = '', ...props }) => {
    const isOpen = openItems && openItems.includes(value);

    return React.createElement('div', {
      className: cn('border-b border-slate-200', className),
      ...props
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, { isOpen, onToggle: () => onToggle(value) });
        }
        return child;
      })
    );
  };

  const AccordionTrigger = ({ children, isOpen, onToggle, className = '', ...props }) => {
    return React.createElement('button', {
      type: 'button',
      className: cn('flex w-full items-center justify-between py-4 font-medium hover:underline', className),
      onClick: onToggle,
      'aria-expanded': isOpen,
      ...props
    },
      children,
      React.createElement('span', {
        className: 'transform transition-transform ' + (isOpen ? 'rotate-180' : '')
      }, '▼')
    );
  };

  const AccordionContent = ({ children, isOpen, className = '', ...props }) => {
    if (!isOpen) return null;

    return React.createElement('div', {
      className: cn('pb-4 pt-0 text-sm', className),
      ...props
    }, children);
  };

  // Toast Components (simplified)
  const Toast = ({ children, variant = 'default', className = '', ...props }) => {
    const variants = {
      default: 'bg-white text-slate-900 border',
      destructive: 'bg-red-500 text-white'
    };

    return React.createElement('div', {
      className: cn(
        'rounded-md p-4 shadow-lg',
        variants[variant],
        className
      ),
      role: 'alert',
      ...props
    }, children);
  };

  const ToastTitle = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('font-semibold', className),
      ...props
    }, children);
  };

  const ToastDescription = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('text-sm', className),
      ...props
    }, children);
  };

  // Alert Component
  const Alert = ({ children, variant = 'default', className = '', ...props }) => {
    const variants = {
      default: 'bg-white text-slate-900 border-slate-200',
      destructive: 'bg-red-50 text-red-900 border-red-200'
    };

    return React.createElement('div', {
      className: cn(
        'relative w-full rounded-lg border p-4',
        variants[variant],
        className
      ),
      role: 'alert',
      ...props
    }, children);
  };

  const AlertTitle = ({ children, className = '', ...props }) => {
    return React.createElement('h5', {
      className: cn('mb-1 font-medium leading-none tracking-tight', className),
      ...props
    }, children);
  };

  const AlertDescription = ({ children, className = '', ...props }) => {
    return React.createElement('div', {
      className: cn('text-sm', className),
      ...props
    }, children);
  };

  // Popover Components
  const Popover = ({ children }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return React.createElement('div', {
      className: 'relative inline-block'
    },
      React.Children.map(children, child => {
        if (child) {
          return React.cloneElement(child, { isOpen, setIsOpen });
        }
        return child;
      })
    );
  };

  const PopoverTrigger = ({ children, isOpen, setIsOpen, className = '', ...props }) => {
    return React.createElement('button', {
      type: 'button',
      onClick: () => setIsOpen(!isOpen),
      className: className,
      ...props
    }, children);
  };

  const PopoverContent = ({ children, isOpen, className = '', ...props }) => {
    if (!isOpen) return null;

    return React.createElement('div', {
      className: cn(
        'absolute z-50 mt-2 rounded-md border bg-white p-4 shadow-md',
        className
      ),
      ...props
    }, children);
  };

  // Make components globally available
  if (typeof window !== 'undefined') {
    window.ShadcnComponents = {
      // Basic components
      Button,
      Card,
      CardHeader,
      CardTitle,
      CardDescription,
      CardContent,
      CardFooter,
      Input,
      Label,
      Badge,
      Avatar,
      AvatarImage,
      AvatarFallback,
      Table,
      TableHeader,
      TableBody,
      TableRow,
      TableHead,
      TableCell,
      Separator,
      // New components (Sprint 5-6)
      Dialog,
      DialogOverlay,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      DialogFooter,
      Select,
      SelectTrigger,
      SelectValue,
      SelectContent,
      SelectItem,
      Tabs,
      TabsList,
      TabsTrigger,
      TabsContent,
      Progress,
      CircularProgress,
      Checkbox,
      RadioGroup,
      RadioGroupItem,
      Accordion,
      AccordionItem,
      AccordionTrigger,
      AccordionContent,
      Toast,
      ToastTitle,
      ToastDescription,
      Alert,
      AlertTitle,
      AlertDescription,
      Popover,
      PopoverTrigger,
      PopoverContent,
      // Utility
      cn
    };
  }
})();